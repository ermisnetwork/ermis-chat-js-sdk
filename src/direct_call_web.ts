import { ErmisChat } from './client';
import { DefaultGenerics, Event, ExtendableGenerics, SignalData } from './types';

enum CallAction {
  CREATE_CALL = 'create-call',
  ACCEPT_CALL = 'accept-call',
  SIGNAL_CALL = 'signal-call',
  CONNECT_CALL = 'connect-call',
  HEALTH_CALL = 'health-call',
  END_CALL = 'end-call',
  REJECT_CALL = 'reject-call',
  MISS_CALL = 'miss-call',
  UPGRADE_CALL = 'upgrade-call',
}

enum CallStatus {
  RINGING = 'ringing',
  ENDED = 'ended',
  CONNECTED = 'connected',
  ERROR = 'error',
}

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
  {
    urls: 'turn:36.50.62.242:3478',
    username: 'hoang',
    credential: 'pass1',
  },
];

type CallEventType = 'incoming' | 'outgoing';

type CallEventData = {
  type: CallEventType;
  callType: string;
  cid: string;
  callerInfo: UserCallInfo | undefined;
  receiverInfo: UserCallInfo | undefined;
};

type UserCallInfo = {
  id: string;
  name?: string;
  avatar?: string;
};

export class ErmisDirectCall<ErmisChatGenerics extends ExtendableGenerics = DefaultGenerics> {
  /** Reference to the Ermis Chat client instance */
  _client: ErmisChat<ErmisChatGenerics>;

  /** Unique identifier for the current call session */
  sessionID: string;

  /** Channel ID for communication between users */
  cid?: string;

  /** Type of call: 'audio' or 'video' */
  callType?: string;

  /** ID of the current user */
  userID?: string | undefined;

  /** Current status of the call */
  callStatus? = '';

  /** WebRTC peer connection instance */
  peerConnection?: RTCPeerConnection | null = null;

  /** WebRTC data channel for sending messages */
  dataChannel?: RTCDataChannel | null = null;

  /** Local media stream from user's camera/microphone */
  localStream?: MediaStream | null = null;

  /** Remote media stream from the other participant */
  remoteStream?: MediaStream | null = null;

  /** Information about the caller */
  callerInfo?: UserCallInfo;

  /** Information about the call receiver */
  receiverInfo?: UserCallInfo;

  /** Callback triggered when call events occur (incoming/outgoing) */
  onCallEvent?: (data: CallEventData) => void;

  /** Callback triggered when local stream is available */
  onLocalStream?: (stream: MediaStream) => void;

  /** Callback triggered when remote stream is available */
  onRemoteStream?: (stream: MediaStream) => void;

  /** Callback for connection status message changes */
  onConnectionMessageChange?: (message: string | null) => void;

  /** Callback for call status changes */
  onCallStatus?: (status: string | null) => void;

  /** Callback for messages received through WebRTC data channel */
  onDataChannelMessage?: (data: any) => void;

  /** Callback for when a call is upgraded (e.g., audio to video) */
  onUpgradeCall?: (upgraderInfo: UserCallInfo) => void;

  /** Callback for screen sharing status changes */
  onScreenShareChange?: (isSharing: boolean) => void;

  /** Callback for error handling */
  onError?: (error: string) => void;

  /** Timeout for ending call if not answered after a period */
  private missCallTimeout: ReturnType<typeof setTimeout> | null = null;

  /** Interval for sending health check via WebRTC */
  private healthCallInterval: ReturnType<typeof setInterval> | null = null;

  /** Interval for sending health check via server */
  private healthCallServerInterval: ReturnType<typeof setInterval> | null = null;

  /** Timeout for detecting if remote peer has disconnected */
  private healthCallTimeout: ReturnType<typeof setTimeout> | null = null;

  /** Timeout for showing warning when connection becomes unstable */
  private healthCallWarningTimeout: ReturnType<typeof setTimeout> | null = null;

  /** Handler for signal events */
  private signalHandler: any;

  /** Handler for connection change events */
  private connectionChangedHandler: any;

  /** Handler for message updated events */
  private messageUpdatedHandler: any;

  /** Flag indicating if the user is offline */
  private isOffline: boolean = false;

  constructor(client: ErmisChat<ErmisChatGenerics>, sessionID: string) {
    this._client = client;
    this.cid = '';
    this.callType = '';
    this.sessionID = sessionID;
    this.userID = client.userID;

    this.listenSocketEvents();
  }

  private getClient(): ErmisChat<ErmisChatGenerics> {
    return this._client;
  }

  async _sendSignal(payload: SignalData) {
    try {
      return await this.getClient().post(this.getClient().baseURL + '/signal', {
        ...payload,
        cid: this.cid || payload.cid,
        is_video: this.callType === 'video' || payload.is_video,
        ios: false,
        session_id: this.sessionID,
      });
    } catch (error: any) {
      if (typeof this.onError === 'function') {
        const action = payload.action;
        if (error.code === 'ERR_NETWORK') {
          if (action === CallAction.CREATE_CALL) {
            this.onError('Unable to make the call. Please check your network connection');
          }
        } else {
          if (error.response.data.ermis_code === 20) {
            this.onError('Recipient was busy');
          } else {
            this.onError('Call Failed');
          }
        }
      }
    }
  }

  async startLocalStream(constraints: MediaStreamConstraints = { audio: true, video: true }) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (this.onLocalStream) {
        this.onLocalStream(stream);
      }
      this.localStream = stream;
      return stream;
    } catch (err) {
      console.error('Error accessing media devices:', err);
      if (this.onError) {
        this.onError('Failed to access camera or microphone');
      }
      throw err;
    }
  }

  private setConnectionMessage(message: string | null) {
    if (typeof this.onConnectionMessageChange === 'function') {
      this.onConnectionMessageChange(message);
    }
  }

  private setCallStatus(status: CallStatus) {
    this.callStatus = status;
    if (typeof this.onCallStatus === 'function') {
      this.onCallStatus(status);
    }
  }

  private setUserInfo(cid: string | undefined, eventUserId: string | undefined) {
    if (!cid || !eventUserId) return;

    // Get caller and receiver userId from activeChannels
    const channel = cid ? this.getClient().activeChannels[cid] : undefined;
    const members = channel?.state?.members || {};
    const memberIds = Object.keys(members);

    // callerId is eventUserId, receiverId is the other user in the channel
    const callerId = eventUserId || '';
    const receiverId = memberIds.find((id) => id !== callerId) || '';

    // Get user info from client.state.users
    const callerUser = this.getClient().state.users[callerId];
    const receiverUser = this.getClient().state.users[receiverId];

    this.callerInfo = {
      id: callerId,
      name: callerUser?.name,
      avatar: callerUser?.avatar || '',
    };
    this.receiverInfo = {
      id: receiverId,
      name: receiverUser?.name,
      avatar: receiverUser?.avatar || '',
    };
  }

  private createPeerConnection(isInitiator: boolean) {
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    // Create new RTCPeerConnection
    this.peerConnection = new RTCPeerConnection({
      iceServers: ICE_SERVERS,
    });

    // Add local stream tracks to peer connection
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        this.peerConnection?.addTrack(track, this.localStream!);
      });
    }

    // Set up data channel
    if (isInitiator) {
      this.dataChannel = this.peerConnection.createDataChannel('rtc_data_channel');
      this.setupDataChannel();
    } else {
      this.peerConnection.ondatachannel = (event) => {
        this.dataChannel = event.channel;
        this.setupDataChannel();
      };
    }

    // Handle ICE candidates
    this.peerConnection.onicecandidate = async (event) => {
      if (event.candidate) {
        // Convert ICE candidate to a format that can be transmitted
        const sdpMid = event.candidate.sdpMid || '';
        const sdpMLineIndex = event.candidate.sdpMLineIndex || 0;
        const candidate = event.candidate.candidate;

        // Format similar to the original implementation
        const sdp = `${sdpMid}$${sdpMLineIndex}$${candidate}`;
        const signal = { type: 'ice', sdp };

        // Send the ICE candidate to the other peer
        await this.signalCall(signal);
      }
    };

    // Connection state changes
    this.peerConnection.onconnectionstatechange = () => {
      switch (this.peerConnection?.connectionState) {
        case 'connected':
          // Peers connected!
          break;
        case 'disconnected':
        case 'failed':
          if (this.callStatus === CallStatus.CONNECTED) {
            this.setConnectionMessage('Connection lost');
          }
          break;
        case 'closed':
          this.cleanupCall();
          break;
      }
    };

    // ICE connection state changes
    this.peerConnection.oniceconnectionstatechange = () => {
      if (this.peerConnection?.iceConnectionState === 'failed') {
        // ICE Gathering failed
        this.setConnectionMessage('Connection failed');
        if (this.onError) {
          this.onError('Connection failed');
        }
      }
    };

    // Handle remote streams
    this.peerConnection.ontrack = (event) => {
      if (!this.remoteStream) {
        this.remoteStream = new MediaStream();
        if (this.onRemoteStream) {
          this.onRemoteStream(this.remoteStream);
        }
      }

      event.streams[0].getTracks().forEach((track) => {
        this.remoteStream?.addTrack(track);
      });
    };
  }

  private setupDataChannel() {
    if (!this.dataChannel) return;

    this.dataChannel.onopen = () => {
      // Data channel is open, can send messages now
      this.sendDataChannelMessage({
        type: 'transciver_state',
        body: {
          audio_enable: true,
          video_enable: this.callType === 'video',
        },
      });

      this.connectCall(); // Signal that the call is connected
      this.setCallStatus(CallStatus.CONNECTED);

      // Clear missCall timeout when connected
      if (this.missCallTimeout) {
        clearTimeout(this.missCallTimeout);
        this.missCallTimeout = null;
      }

      // Set up health_call interval via WebRTC every 1s
      if (this.healthCallInterval) clearInterval(this.healthCallInterval);
      this.healthCallInterval = setInterval(() => {
        this.sendDataChannelMessage({ type: 'health_call' });
      }, 1000);

      // Set up healthCall interval via server every 10s
      if (this.healthCallServerInterval) clearInterval(this.healthCallServerInterval);
      this.healthCallServerInterval = setInterval(() => {
        this.healthCall();
      }, 10000);
    };

    this.dataChannel.onclose = () => {
      console.log('Data channel closed');
    };

    this.dataChannel.onerror = (error) => {
      console.error('Data channel error:', error);
      if (this.onError) {
        this.onError('Data channel error');
      }
    };

    this.dataChannel.onmessage = (event) => {
      const message = JSON.parse(event.data);

      if (typeof this.onDataChannelMessage === 'function') {
        this.onDataChannelMessage(message);
      }

      // Handle health_call
      if (message.type === 'health_call') {
        // Reset timeout whenever health_call is received
        if (this.healthCallTimeout) clearTimeout(this.healthCallTimeout);
        this.healthCallTimeout = setTimeout(async () => {
          // If no health_call is received after 30s, end the call
          await this.endCall();
        }, 30000);

        // Reset remote connection lost warning
        if (this.healthCallWarningTimeout) clearTimeout(this.healthCallWarningTimeout);
        this.setConnectionMessage(null);

        // If no health_call is received after 3s, show remote peer connection unstable warning
        this.healthCallWarningTimeout = setTimeout(() => {
          if (!this.isOffline) {
            this.setConnectionMessage(
              `${
                this.userID === this.callerInfo?.id ? this.receiverInfo?.name : this.callerInfo?.name
              } network connection is unstable`,
            );
          }
        }, 3000);
      }
    };
  }

  private sendDataChannelMessage(data: any) {
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      this.dataChannel.send(JSON.stringify(data));
    }
  }

  private async makeOffer() {
    this.createPeerConnection(true); // initiator = true

    if (!this.peerConnection) return;

    try {
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);

      // Send offer to the other peer
      await this.signalCall(this.peerConnection.localDescription);
    } catch (err) {
      console.error('Error creating offer:', err);
      if (this.onError) {
        this.onError('Failed to create offer');
      }
    }
  }

  private async handleOffer(offer: RTCSessionDescriptionInit) {
    this.createPeerConnection(false); // initiator = false

    if (!this.peerConnection) return;

    try {
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);

      // Send answer to the other peer
      await this.signalCall(this.peerConnection.localDescription);
    } catch (err) {
      console.error('Error handling offer:', err);
      if (this.onError) {
        this.onError('Failed to handle offer');
      }
    }
  }

  private async handleAnswer(answer: RTCSessionDescriptionInit) {
    if (!this.peerConnection) return;

    try {
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    } catch (err) {
      console.error('Error handling answer:', err);
      if (this.onError) {
        this.onError('Failed to handle answer');
      }
    }
  }

  private async handleIceCandidate(iceData: any) {
    if (!this.peerConnection) return;

    try {
      const parts = iceData.sdp.split('$');
      const candidate = new RTCIceCandidate({
        sdpMid: parts[0],
        sdpMLineIndex: parseInt(parts[1], 10),
        candidate: parts[2],
      });

      await this.peerConnection.addIceCandidate(candidate);
    } catch (err) {
      console.error('Error adding ICE candidate:', err);
    }
  }

  private listenSocketEvents() {
    this.signalHandler = async (event: Event<ErmisChatGenerics>) => {
      const { action, user_id: eventUserId, session_id: eventSessionId, cid, is_video, signal } = event;

      switch (action) {
        case CallAction.CREATE_CALL:
          await this.startLocalStream({ audio: true, video: true });
          this.setUserInfo(cid, eventUserId);
          this.setCallStatus(CallStatus.RINGING);
          this.callType = is_video ? 'video' : 'audio';
          this.cid = cid || '';
          if (typeof this.onCallEvent === 'function') {
            if (eventUserId !== this.userID) {
              // Incoming call
              this.onCallEvent({
                type: 'incoming',
                callType: is_video ? 'video' : 'audio',
                cid: cid || '',
                callerInfo: this.callerInfo,
                receiverInfo: this.receiverInfo,
              });
            } else {
              // Outgoing call
              this.onCallEvent({
                type: 'outgoing',
                callType: is_video ? 'video' : 'audio',
                cid: cid || '',
                callerInfo: this.callerInfo,
                receiverInfo: this.receiverInfo,
              });
            }
          }
          // Set missCall timeout if no connection after 60s
          if (this.missCallTimeout) clearTimeout(this.missCallTimeout);
          this.missCallTimeout = setTimeout(async () => {
            await this.missCall();
          }, 60000);
          break;

        case CallAction.ACCEPT_CALL:
          if (eventUserId !== this.userID) {
            // Caller: when receiver accepts, create offer and send to receiver
            await this.makeOffer();
          } else {
            if (eventSessionId !== this.sessionID) {
              this.setCallStatus(CallStatus.ENDED);
              this.destroy();
            }
          }
          break;

        case CallAction.SIGNAL_CALL:
          if (eventUserId === this.userID) return;

          if (typeof signal === 'object' && signal !== null && 'type' in signal) {
            const signalObj = signal as { type: string; [key: string]: any };
            if (signalObj.type === 'offer') {
              await this.handleOffer(signalObj as RTCSessionDescriptionInit);
            } else if (signalObj.type === 'answer') {
              await this.handleAnswer(signalObj as RTCSessionDescriptionInit);
            } else if (signalObj.type === 'ice') {
              await this.handleIceCandidate(signalObj);
            }
          }
          break;

        case CallAction.END_CALL:
        case CallAction.REJECT_CALL:
        case CallAction.MISS_CALL:
          this.setCallStatus(CallStatus.ENDED);
          this.destroy();
          break;
      }
    };

    this.connectionChangedHandler = (event: Event<ErmisChatGenerics>) => {
      const online = event.online;
      this.isOffline = !online;
      if (!online) {
        this.setConnectionMessage('Your network connection is unstable');

        // Clear health_call intervals when offline
        if (this.healthCallInterval) {
          clearInterval(this.healthCallInterval);
          this.healthCallInterval = null;
        }
        if (this.healthCallServerInterval) {
          clearInterval(this.healthCallServerInterval);
          this.healthCallServerInterval = null;
        }
      } else {
        this.setConnectionMessage(null);

        // When back online, if CONNECTED, set up health_call intervals again
        if (this.callStatus === CallStatus.CONNECTED && this.dataChannel) {
          if (!this.healthCallInterval) {
            this.healthCallInterval = setInterval(() => {
              this.sendDataChannelMessage({ type: 'health_call' });
            }, 1000);
          }
          if (!this.healthCallServerInterval) {
            this.healthCallServerInterval = setInterval(() => {
              this.healthCall();
            }, 10000);
          }
        }
      }
    };

    this.messageUpdatedHandler = (event: Event<ErmisChatGenerics>) => {
      if (this.callStatus === CallStatus.CONNECTED && event.cid === this.cid) {
        const upgradeUserId = event.user?.id;

        let upgraderInfo: UserCallInfo | undefined;

        if (upgradeUserId === this.callerInfo?.id) {
          upgraderInfo = this.callerInfo;
        } else if (upgradeUserId === this.receiverInfo?.id) {
          upgraderInfo = this.receiverInfo;
        }

        if (upgraderInfo && typeof this.onUpgradeCall === 'function') {
          this.onUpgradeCall(upgraderInfo);
        }

        if (upgradeUserId === this.userID) {
          this.sendDataChannelMessage({
            type: 'transciver_state',
            body: {
              audio_enable: this.localStream?.getAudioTracks().some((track) => track.enabled),
              video_enable: true,
            },
          });
        }
      }
    };

    this._client.on('signal', this.signalHandler);
    this._client.on('connection.changed', this.connectionChangedHandler);
    this._client.on('message.updated', this.messageUpdatedHandler);
  }

  private cleanupCall() {
    // Close data channel
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }

    // Close peer connection
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    // Stop local stream if exists
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }

    // Clear missCall timeout
    if (this.missCallTimeout) {
      clearTimeout(this.missCallTimeout);
      this.missCallTimeout = null;
    }

    // Clear healthCall interval via WebRTC
    if (this.healthCallInterval) {
      clearInterval(this.healthCallInterval);
      this.healthCallInterval = null;
    }

    // Clear healthCall interval via server
    if (this.healthCallServerInterval) {
      clearInterval(this.healthCallServerInterval);
      this.healthCallServerInterval = null;
    }

    // Clear healthCall timeout
    if (this.healthCallTimeout) {
      clearTimeout(this.healthCallTimeout);
      this.healthCallTimeout = null;
    }

    // Clear healthCall warning timeout
    if (this.healthCallWarningTimeout) {
      clearTimeout(this.healthCallWarningTimeout);
      this.healthCallWarningTimeout = null;
    }

    this.setConnectionMessage(null);
  }

  private destroy() {
    // Clean up WebRTC resources
    this.cleanupCall();
  }

  public async createCall(callType: string, cid: string) {
    return await this._sendSignal({ action: CallAction.CREATE_CALL, cid, is_video: callType === 'video' });
  }

  public async acceptCall() {
    return await this._sendSignal({ action: CallAction.ACCEPT_CALL });
  }

  private async signalCall(signal: any) {
    return await this._sendSignal({ action: CallAction.SIGNAL_CALL, signal });
  }

  public async endCall() {
    return await this._sendSignal({ action: CallAction.END_CALL });
  }

  public async rejectCall() {
    return await this._sendSignal({ action: CallAction.REJECT_CALL });
  }

  private async missCall() {
    return await this._sendSignal({ action: CallAction.MISS_CALL });
  }

  private async connectCall() {
    return await this._sendSignal({ action: CallAction.CONNECT_CALL });
  }

  private async healthCall() {
    return await this._sendSignal({ action: CallAction.HEALTH_CALL });
  }

  public async upgradeCall() {
    if (this.callType === 'audio') {
      return await this._sendSignal({ action: CallAction.UPGRADE_CALL });
    }
    return null;
  }

  public async startScreenShare() {
    if (!navigator.mediaDevices.getDisplayMedia) {
      throw new Error('Screen sharing is not supported in this browser.');
    }

    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const screenTrack = screenStream.getVideoTracks()[0];

      // Replace video track in localStream
      if (this.localStream) {
        // Stop old track
        this.localStream.getVideoTracks().forEach((track) => track.stop());
        // Add new track to localStream
        this.localStream.removeTrack(this.localStream.getVideoTracks()[0]);
        this.localStream.addTrack(screenTrack);
      } else {
        // If no localStream, create new one
        this.localStream = screenStream;
      }

      // Replace video track in RTCPeerConnection
      if (this.peerConnection) {
        const senders = this.peerConnection.getSenders();
        const videoSender = senders.find((sender) => sender.track && sender.track.kind === 'video');

        if (videoSender) {
          await videoSender.replaceTrack(screenTrack);
        }
      }

      // When screen sharing stops, automatically revert to camera
      screenTrack.onended = () => {
        this.stopScreenShare();
      };

      // Call callback if UI needs to be updated
      if (this.onLocalStream) {
        this.onLocalStream(this.localStream);
      }

      // Call callback when starting screen share
      if (typeof this.onScreenShareChange === 'function') {
        this.onScreenShareChange(true);
      }
    } catch (err) {
      console.error('Error starting screen share:', err);
      if (this.onError) {
        this.onError('Failed to start screen sharing');
      }
    }
  }

  public async stopScreenShare() {
    try {
      // Get camera stream again
      const cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      const cameraTrack = cameraStream.getVideoTracks()[0];

      // Replace video track in localStream
      if (this.localStream) {
        // Stop old (screen) track
        this.localStream.getVideoTracks().forEach((track) => track.stop());
        // Replace with camera track
        this.localStream.removeTrack(this.localStream.getVideoTracks()[0]);
        this.localStream.addTrack(cameraTrack);
      } else {
        this.localStream = cameraStream;
      }

      // Replace video track in RTCPeerConnection
      if (this.peerConnection) {
        const senders = this.peerConnection.getSenders();
        const videoSender = senders.find((sender) => sender.track && sender.track.kind === 'video');

        if (videoSender) {
          await videoSender.replaceTrack(cameraTrack);
        }
      }

      // Call callback if UI needs to be updated
      if (this.onLocalStream) {
        this.onLocalStream(this.localStream);
      }

      // Call callback when stopping screen share
      if (typeof this.onScreenShareChange === 'function') {
        this.onScreenShareChange(false);
      }
    } catch (err) {
      console.error('Error stopping screen share:', err);
      if (this.onError) {
        this.onError('Failed to stop screen sharing');
      }
    }
  }

  public toggleMic(enabled: boolean) {
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((track) => {
        track.enabled = enabled;
      });

      this.sendDataChannelMessage({
        type: 'transciver_state',
        body: {
          audio_enable: enabled,
          video_enable: this.localStream.getVideoTracks().some((track) => track.enabled),
        },
      });
    }
  }

  public toggleCamera(enabled: boolean) {
    if (this.localStream) {
      this.localStream.getVideoTracks().forEach((track) => {
        track.enabled = enabled;
      });

      this.sendDataChannelMessage({
        type: 'transciver_state',
        body: {
          audio_enable: this.localStream.getAudioTracks().some((track) => track.enabled),
          video_enable: enabled,
        },
      });
    }
  }
}
