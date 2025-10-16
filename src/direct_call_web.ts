import { ErmisChat } from './client';
import {
  CallAction,
  CallEventData,
  CallStatus,
  DefaultGenerics,
  Event,
  ExtendableGenerics,
  SignalData,
  UserCallInfo,
} from './types';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
  {
    urls: 'turn:36.50.62.242:3478',
    username: 'hoang',
    credential: 'pass1',
  },
];

// Interface for WebRTC signal data
interface RTCSignalData {
  type: string;
  sdp?: string;
}

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
  peer?: RTCPeerConnection | null = null;

  /** WebRTC data channel instance */
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

  /** Callback for device list changes */
  onDeviceChange?: (audioDevices: MediaDeviceInfo[], videoDevices: MediaDeviceInfo[]) => void;

  /** Available audio input devices */
  private availableAudioDevices: MediaDeviceInfo[] = [];

  /** Available video input devices */
  private availableVideoDevices: MediaDeviceInfo[] = [];

  /** Currently selected audio device ID */
  private selectedAudioDeviceId?: string;

  /** Currently selected video device ID */
  private selectedVideoDeviceId?: string;

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

  /**
   * True if this call instance is destroyed (e.g., when another device accepts the call).
   * When true, SIGNAL_CALL events will be ignored.
   */
  private isDestroyed = false;

  constructor(client: ErmisChat<ErmisChatGenerics>, sessionID: string) {
    this._client = client;
    this.cid = '';
    this.callType = '';
    this.sessionID = sessionID;
    this.userID = client.userID;

    this.listenSocketEvents();
    this.setupDeviceChangeListener();
  }

  private getClient(): ErmisChat<ErmisChatGenerics> {
    return this._client;
  }

  private async _sendSignal(payload: SignalData) {
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
            const errMsg = error.response.data?.message ? error.response.data?.message : 'Call failed';
            this.onError(errMsg);
          }
        }
      }
    }
  }

  private async getAvailableDevices(): Promise<{ audioDevices: MediaDeviceInfo[]; videoDevices: MediaDeviceInfo[] }> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();

      const audioDevices = devices.filter((device) => device.kind === 'audioinput');
      const videoDevices = devices.filter((device) => device.kind === 'videoinput');

      this.availableAudioDevices = audioDevices;
      this.availableVideoDevices = videoDevices;

      return { audioDevices, videoDevices };
    } catch (error) {
      console.error('Error enumerating devices:', error);
      return { audioDevices: [], videoDevices: [] };
    }
  }

  private async startLocalStream(constraints: MediaStreamConstraints = { audio: true, video: true }) {
    // Get available devices first
    const { audioDevices, videoDevices } = await this.getAvailableDevices();

    // Notify UI about available devices
    if (this.onDeviceChange) {
      this.onDeviceChange(audioDevices, videoDevices);
    }

    const hasCamera = videoDevices.length > 0;

    // Auto-select default devices if none selected
    if (!this.selectedAudioDeviceId && audioDevices.length > 0) {
      this.selectedAudioDeviceId = audioDevices[0].deviceId;
    }
    if (!this.selectedVideoDeviceId && videoDevices.length > 0) {
      this.selectedVideoDeviceId = videoDevices[0].deviceId;
    }

    // Build constraints with specific device IDs if selected
    const audioConstraints = constraints.audio
      ? {
          deviceId: this.selectedAudioDeviceId ? { exact: this.selectedAudioDeviceId } : undefined,
        }
      : false;

    const videoConstraints =
      hasCamera && constraints.video
        ? {
            deviceId: this.selectedVideoDeviceId ? { exact: this.selectedVideoDeviceId } : undefined,
          }
        : false;

    const finalConstraints: MediaStreamConstraints = {
      audio: audioConstraints,
      video: videoConstraints,
    };

    try {
      // Request the media stream with the determined constraints
      const stream = await navigator.mediaDevices.getUserMedia(finalConstraints);
      if (this.callStatus === CallStatus.ENDED) {
        // If the call has ended, stop the local stream tracks
        stream.getTracks().forEach((track) => track.stop());
        this.destroy();
        return;
      }
      if (this.onLocalStream) {
        this.onLocalStream(stream);
      }
      this.localStream = stream;
      return stream;
    } catch (error) {
      console.error('Error getting user media:', error);
      // if (typeof this.onError === 'function') {
      //   this.onError('Unable to access microphone/camera');
      // }
      return null;
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

  private createPeer(initiator: boolean) {
    if (this.peer) {
      this.peer.close();
      this.peer = null;
      this.dataChannel = null;
    }

    // Create new RTCPeerConnection with ICE servers
    this.peer = new RTCPeerConnection({
      iceServers: ICE_SERVERS,
    });

    // Add local stream to peer connection
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        if (this.localStream && this.peer) {
          this.peer.addTrack(track, this.localStream);
        }
      });
    }

    // Handle ICE candidates
    this.peer.onicecandidate = async (event) => {
      if (event.candidate) {
        const sdpMid = event.candidate.sdpMid || '';
        const sdpMLineIndex = event.candidate.sdpMLineIndex || 0;
        const candidate = event.candidate.candidate;
        const sdp = `${sdpMid}$${sdpMLineIndex}$${candidate}`;

        // Send ICE candidate to server
        await this.signalCall({
          type: 'ice',
          sdp,
        });
      }
    };

    // Handle receiving remote stream
    this.peer.ontrack = (event) => {
      this.remoteStream = event.streams[0];
      if (this.onRemoteStream) {
        this.onRemoteStream(event.streams[0]);
      }
    };

    // Handle ICE connection state changes
    this.peer.oniceconnectionstatechange = () => {
      if (this.peer?.iceConnectionState === 'connected' || this.peer?.iceConnectionState === 'completed') {
        this.setCallStatus(CallStatus.CONNECTED);

        // Clear missCall timeout when connected
        if (this.missCallTimeout) {
          clearTimeout(this.missCallTimeout);
          this.missCallTimeout = null;
        }

        // Perform connectCall
        this.connectCall();

        // Set up health_call interval via WebRTC
        if (this.healthCallInterval) clearInterval(this.healthCallInterval);
        this.healthCallInterval = setInterval(() => {
          if (this.dataChannel?.readyState === 'open') {
            this.dataChannel.send(JSON.stringify({ type: 'health_call' }));
          }
        }, 1000);

        // Set up healthCall interval via server
        if (this.healthCallServerInterval) clearInterval(this.healthCallServerInterval);
        this.healthCallServerInterval = setInterval(() => {
          this.healthCall();
        }, 10000);
      } else if (
        this.peer?.iceConnectionState === 'failed' ||
        this.peer?.iceConnectionState === 'disconnected' ||
        this.peer?.iceConnectionState === 'closed'
      ) {
        this.setCallStatus(CallStatus.ERROR);
        this.cleanupCall();
      }
    };

    // Create data channel if initiator
    if (initiator) {
      this.dataChannel = this.peer.createDataChannel('rtc_data_channel');
      this.setupDataChannel();
    } else {
      // Register event to receive data channel from initiator
      this.peer.ondatachannel = (event) => {
        this.dataChannel = event.channel;
        this.setupDataChannel();
      };
    }

    // If initiator, create offer
    if (initiator) {
      this.createOffer();
    }
  }

  // Set up and handle data channel
  private setupDataChannel() {
    if (!this.dataChannel) return;

    this.dataChannel.onopen = () => {
      // Send initial state when connection is established
      if (this.dataChannel?.readyState === 'open') {
        const jsonData = {
          type: 'transciver_state',
          body: {
            audio_enable: true,
            video_enable: this.callType === 'video',
          },
        };

        this.dataChannel.send(JSON.stringify(jsonData));
      }
    };

    this.dataChannel.onmessage = (event) => {
      let jsonString: string;

      if (typeof event.data === 'string') {
        jsonString = event.data;
      } else if (event.data instanceof ArrayBuffer) {
        jsonString = new TextDecoder().decode(event.data);
      } else {
        console.warn('Unknown data type received on data channel:', event.data);
        return;
      }

      const message = JSON.parse(jsonString);

      if (typeof this.onDataChannelMessage === 'function') {
        this.onDataChannelMessage(message);
      }

      // Handle health_call
      if (message.type === 'health_call') {
        // Reset timeout every time health_call is received
        if (this.healthCallTimeout) clearTimeout(this.healthCallTimeout);
        this.healthCallTimeout = setTimeout(async () => {
          // If no health_call received after 30s, end the call
          await this.endCall();
        }, 30000);

        // Reset connection lost warning
        if (this.healthCallWarningTimeout) clearTimeout(this.healthCallWarningTimeout);
        this.setConnectionMessage(null);

        // If no health_call received after 3s, show warning
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

    this.dataChannel.onerror = (error) => {
      console.error('Data channel error:', error);
    };

    this.dataChannel.onclose = () => {
      this.dataChannel = null;
    };
  }

  // Method to create offer
  private async createOffer() {
    if (!this.peer) return;

    try {
      const offer = await this.peer.createOffer();
      await this.peer.setLocalDescription(offer);
      await this.signalCall(offer);
    } catch (error) {
      console.error('Error creating offer:', error);
      if (typeof this.onError === 'function') {
        this.onError('Error creating offer');
      }
    }
  }

  private async makeOffer() {
    this.createPeer(true); // initiator = true
  }

  private async handleOffer(offer: RTCSignalData) {
    this.createPeer(false); // initiator = false

    if (this.peer && offer.sdp) {
      try {
        await this.peer.setRemoteDescription(
          new RTCSessionDescription({
            type: 'offer',
            sdp: offer.sdp,
          }),
        );

        // Create answer
        const answer = await this.peer.createAnswer();
        await this.peer.setLocalDescription(answer);
        await this.signalCall(answer);
      } catch (error) {
        console.error('Error handling offer:', error);
        if (typeof this.onError === 'function') {
          this.onError('Error handling offer');
        }
      }
    }
  }

  private async handleAnswer(answer: RTCSignalData) {
    if (this.peer && answer.sdp) {
      try {
        await this.peer.setRemoteDescription(
          new RTCSessionDescription({
            type: 'answer',
            sdp: answer.sdp,
          }),
        );
      } catch (error) {
        console.error('Error handling answer:', error);
        if (typeof this.onError === 'function') {
          this.onError('Error handling answer');
        }
      }
    }
  }

  private async handleIceCandidate(candidate: RTCSignalData) {
    if (this.peer && candidate.sdp) {
      try {
        const splitSdp = candidate.sdp.split('$');
        const iceCandidate = new RTCIceCandidate({
          candidate: splitSdp[2],
          sdpMLineIndex: Number(splitSdp[1]),
          sdpMid: splitSdp[0],
        });

        await this.peer.addIceCandidate(iceCandidate);
      } catch (error) {
        console.error('Error adding ICE candidate:', error);
      }
    }
  }

  private listenSocketEvents() {
    this.signalHandler = async (event: Event<ErmisChatGenerics>) => {
      const { action, user_id: eventUserId, session_id: eventSessionId, cid, is_video, signal } = event;

      switch (action) {
        case CallAction.CREATE_CALL:
          if (eventUserId === this.userID && eventSessionId !== this.sessionID) {
            // If the event is triggered by the current user but the session ID is different,
            // it means another device (or tab) of the same user has started a call.
            // In this case, mark this call instance as destroyed and ignore further events.
            this.isDestroyed = true;
            this.destroy();
            return;
          }
          this.isDestroyed = false;
          this.callStatus = '';
          await this.startLocalStream({ audio: true, video: true });
          if (this.callStatus === CallStatus.ENDED) return;
          this.setUserInfo(cid, eventUserId);
          this.setCallStatus(CallStatus.RINGING);
          this.callType = is_video ? 'video' : 'audio';
          this.cid = cid || '';
          if (typeof this.onCallEvent === 'function') {
            this.onCallEvent({
              type: eventUserId !== this.userID ? 'incoming' : 'outgoing',
              callType: is_video ? 'video' : 'audio',
              cid: cid || '',
              callerInfo: this.callerInfo,
              receiverInfo: this.receiverInfo,
            });
          }
          // Set missCall timeout if no connection after 60s
          if (this.missCallTimeout) clearTimeout(this.missCallTimeout);
          this.missCallTimeout = setTimeout(async () => {
            await this.missCall();
          }, 60000);
          break;

        case CallAction.ACCEPT_CALL:
          if (eventUserId !== this.userID && !this.isDestroyed) {
            // Caller: when receiver accepts, create offer and send to receiver
            await this.makeOffer();
            return;
          }

          if (eventSessionId !== this.sessionID) {
            // If the event is triggered by the current user but the session ID is different,
            // This means another device (or tab) of the same user has answered the call.
            // In this case, end and destroy the current call instance, and mark it as destroyed
            // so it will ignore further call events.
            this.setCallStatus(CallStatus.ENDED);
            this.destroy();
            this.isDestroyed = true;
          }
          break;

        case CallAction.SIGNAL_CALL:
          if (eventUserId === this.userID || this.isDestroyed) return;

          if (typeof signal === 'object' && signal !== null && 'type' in signal) {
            const signalObj = signal as RTCSignalData;
            if (signalObj.type === 'offer') {
              await this.handleOffer(signalObj);
            } else if (signalObj.type === 'answer') {
              await this.handleAnswer(signalObj);
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
        if (this.callStatus === CallStatus.CONNECTED && this.peer) {
          if (!this.healthCallInterval) {
            this.healthCallInterval = setInterval(() => {
              if (this.dataChannel?.readyState === 'open') {
                this.dataChannel.send(JSON.stringify({ type: 'health_call' }));
              }
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
          this.callType = 'video'; // Upgrade call type to video
        }

        if (upgradeUserId === this.userID) {
          const jsonData = {
            type: 'transciver_state',
            body: {
              audio_enable: this.localStream?.getAudioTracks().some((track) => track.enabled),
              video_enable: true,
            },
          };

          if (this.dataChannel?.readyState === 'open') {
            this.dataChannel.send(JSON.stringify(jsonData));
          }
        }
      }
    };

    this._client.on('signal', this.signalHandler);
    this._client.on('connection.changed', this.connectionChangedHandler);
    this._client.on('message.updated', this.messageUpdatedHandler);
  }

  private cleanupCall() {
    // Close peer connection
    if (this.peer) {
      this.peer.close();
      this.peer = null;
    }

    // Close data channel
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }

    // Stop local stream if exists
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }

    // Clear all timeouts and intervals
    if (this.missCallTimeout) {
      clearTimeout(this.missCallTimeout);
      this.missCallTimeout = null;
    }

    if (this.healthCallInterval) {
      clearInterval(this.healthCallInterval);
      this.healthCallInterval = null;
    }

    if (this.healthCallServerInterval) {
      clearInterval(this.healthCallServerInterval);
      this.healthCallServerInterval = null;
    }

    if (this.healthCallTimeout) {
      clearTimeout(this.healthCallTimeout);
      this.healthCallTimeout = null;
    }

    if (this.healthCallWarningTimeout) {
      clearTimeout(this.healthCallWarningTimeout);
      this.healthCallWarningTimeout = null;
    }

    this.setConnectionMessage(null);
    this.cid = '';
    this.callType = '';
  }

  private destroy() {
    // if (this.signalHandler) this._client.off('signal', this.signalHandler);
    // if (this.connectionChangedHandler) this._client.off('connection.changed', this.connectionChangedHandler);
    // if (this.messageUpdatedHandler) this._client.off('message.updated', this.messageUpdatedHandler);
    this.cleanupCall();
  }

  public async getDevices(): Promise<{ audioDevices: MediaDeviceInfo[]; videoDevices: MediaDeviceInfo[] }> {
    // Return cached devices if available, otherwise fetch new ones
    if (this.availableAudioDevices.length > 0 || this.availableVideoDevices.length > 0) {
      return {
        audioDevices: this.availableAudioDevices,
        videoDevices: this.availableVideoDevices,
      };
    }
    return await this.getAvailableDevices();
  }

  // Get current selected devices info
  public getSelectedDevices(): { audioDevice?: MediaDeviceInfo; videoDevice?: MediaDeviceInfo } {
    const audioDevice = this.selectedAudioDeviceId
      ? this.availableAudioDevices.find((device) => device.deviceId === this.selectedAudioDeviceId)
      : undefined;

    const videoDevice = this.selectedVideoDeviceId
      ? this.availableVideoDevices.find((device) => device.deviceId === this.selectedVideoDeviceId)
      : undefined;

    return { audioDevice, videoDevice };
  }

  // Get default devices (first available device)
  public getDefaultDevices(): { audioDevice?: MediaDeviceInfo; videoDevice?: MediaDeviceInfo } {
    return {
      audioDevice: this.availableAudioDevices[0],
      videoDevice: this.availableVideoDevices[0],
    };
  }

  public async createCall(callType: string, cid: string) {
    this.cid = cid;
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
    // @ts-ignore
    if (!navigator.mediaDevices.getDisplayMedia) {
      throw new Error('Screen sharing is not supported in this browser.');
    }

    // @ts-ignore
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

    // Replace video track in peer connection
    if (this.peer) {
      const senders = this.peer.getSenders();
      const videoSender = senders.find((s) => s.track && s.track.kind === 'video');
      if (videoSender) {
        await videoSender.replaceTrack(screenTrack);
      }
    }

    // When screen sharing stops, automatically switch back to camera
    screenTrack.onended = () => {
      this.stopScreenShare();
    };

    // Call callback if UI needs to update
    if (this.onLocalStream) {
      // @ts-ignore
      this.onLocalStream(this.localStream);
    }

    // Call callback when screen sharing starts
    if (typeof this.onScreenShareChange === 'function') {
      this.onScreenShareChange(true);
    }
  }

  public async stopScreenShare() {
    // Get camera stream again
    const cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    const cameraTrack = cameraStream.getVideoTracks()[0];

    // Replace video track in localStream
    if (this.localStream) {
      // Stop old track (screen)
      this.localStream.getVideoTracks().forEach((track) => track.stop());
      // Replace with camera track
      this.localStream.removeTrack(this.localStream.getVideoTracks()[0]);
      this.localStream.addTrack(cameraTrack);
    } else {
      this.localStream = cameraStream;
    }

    // Replace video track in peer connection
    if (this.peer) {
      const senders = this.peer.getSenders();
      const videoSender = senders.find((s) => s.track && s.track.kind === 'video');
      if (videoSender) {
        await videoSender.replaceTrack(cameraTrack);
      }
    }

    // Call callback if UI needs to update
    if (this.onLocalStream) {
      this.onLocalStream(this.localStream);
    }

    // Call callback when screen sharing stops
    if (typeof this.onScreenShareChange === 'function') {
      this.onScreenShareChange(false);
    }
  }

  public toggleMic(enabled: boolean) {
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((track) => {
        track.enabled = enabled;
      });

      if (this.dataChannel && this.dataChannel.readyState === 'open') {
        this.dataChannel.send(
          JSON.stringify({
            type: 'transciver_state',
            body: {
              audio_enable: enabled,
              video_enable: this.callType === 'video',
              // video_enable: this.localStream.getVideoTracks().some((track) => track.enabled),
            },
          }),
        );
      }
    }
  }

  public toggleCamera(enabled: boolean) {
    if (this.localStream) {
      this.localStream.getVideoTracks().forEach((track) => {
        track.enabled = enabled;
      });

      if (this.dataChannel && this.dataChannel.readyState === 'open') {
        this.dataChannel.send(
          JSON.stringify({
            type: 'transciver_state',
            body: {
              audio_enable: this.localStream.getAudioTracks().some((track) => track.enabled),
              video_enable: enabled,
            },
          }),
        );
      }
    }
  }

  // Public method to switch audio device
  public async switchAudioDevice(deviceId: string): Promise<boolean> {
    try {
      // Validate device exists in available devices
      const targetDevice = this.availableAudioDevices.find((device) => device.deviceId === deviceId);
      if (!targetDevice) {
        console.error('Audio device not found:', deviceId);
        if (this.onError) {
          this.onError('Selected microphone not found');
        }
        return false;
      }

      this.selectedAudioDeviceId = deviceId;

      if (!this.localStream) return false;

      // Get new audio stream with selected device
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: deviceId } },
        video: false,
      });

      const newAudioTrack = newStream.getAudioTracks()[0];
      const oldAudioTrack = this.localStream.getAudioTracks()[0];

      // Replace audio track in peer connection
      if (this.peer && oldAudioTrack) {
        const sender = this.peer.getSenders().find((s) => s.track === oldAudioTrack);
        if (sender) {
          await sender.replaceTrack(newAudioTrack);
        }
      }

      // Replace audio track in local stream
      if (oldAudioTrack) {
        this.localStream.removeTrack(oldAudioTrack);
        oldAudioTrack.stop();
      }
      this.localStream.addTrack(newAudioTrack);

      // Update UI
      if (this.onLocalStream) {
        this.onLocalStream(this.localStream);
      }

      return true;
    } catch (error) {
      console.error('Error switching audio device:', error);
      if (this.onError) {
        this.onError('Failed to switch microphone');
      }
      return false;
    }
  }

  // Public method to switch video device
  public async switchVideoDevice(deviceId: string): Promise<boolean> {
    try {
      // Validate device exists in available devices
      const targetDevice = this.availableVideoDevices.find((device) => device.deviceId === deviceId);
      if (!targetDevice) {
        console.error('Video device not found:', deviceId);
        if (this.onError) {
          this.onError('Selected camera not found');
        }
        return false;
      }

      this.selectedVideoDeviceId = deviceId;

      if (!this.localStream) return false;

      // Get new video stream with selected device
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { deviceId: { exact: deviceId } },
      });

      const newVideoTrack = newStream.getVideoTracks()[0];
      const oldVideoTrack = this.localStream.getVideoTracks()[0];

      // Replace video track in peer connection
      if (this.peer && oldVideoTrack) {
        const sender = this.peer.getSenders().find((s) => s.track === oldVideoTrack);
        if (sender) {
          await sender.replaceTrack(newVideoTrack);
        }
      }

      // Replace video track in local stream
      if (oldVideoTrack) {
        this.localStream.removeTrack(oldVideoTrack);
        oldVideoTrack.stop();
      }
      this.localStream.addTrack(newVideoTrack);

      // Update UI
      if (this.onLocalStream) {
        this.onLocalStream(this.localStream);
      }

      return true;
    } catch (error) {
      console.error('Error switching video device:', error);
      if (this.onError) {
        this.onError('Failed to switch camera');
      }
      return false;
    }
  }

  // Listen for device changes
  private setupDeviceChangeListener() {
    navigator.mediaDevices.addEventListener('devicechange', async () => {
      const { audioDevices, videoDevices } = await this.getAvailableDevices();
      if (this.onDeviceChange) {
        this.onDeviceChange(audioDevices, videoDevices);
      }
    });
  }
}
