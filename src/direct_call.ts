import { ErmisChat } from './client';
import { DefaultGenerics, Event, ExtendableGenerics, SignalData } from './types';
import SimplePeer, { Instance as SimplePeerInstance, SignalData as SimplePeerSignalData } from 'simple-peer';

export enum CallAction {
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

export enum CallStatus {
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
  _client: ErmisChat<ErmisChatGenerics>;
  sessionID: string;
  cid?: string;
  callType?: string;
  userID?: string | undefined;
  callStatus? = '';
  peer?: SimplePeerInstance | null = null;
  localStream?: MediaStream | null = null;
  remoteStream?: MediaStream | null = null;
  callerInfo?: UserCallInfo;
  receiverInfo?: UserCallInfo;
  onCallEvent?: (data: CallEventData) => void;
  onLocalStream?: (stream: MediaStream) => void;
  onRemoteStream?: (stream: MediaStream) => void;
  onConnectionMessageChange?: (message: string | null) => void;
  onCallStatus?: (status: string | null) => void;
  onDataChannelMessage?: (data: any) => void;
  onUpgradeCall?: (upgraderInfo: UserCallInfo) => void;
  onScreenShareChange?: (isSharing: boolean) => void;
  onError?: (error: string) => void;

  private missCallTimeout: NodeJS.Timeout | null = null;
  private healthCallInterval: NodeJS.Timeout | null = null;
  private healthCallServerInterval: NodeJS.Timeout | null = null;
  private healthCallTimeout: NodeJS.Timeout | null = null;
  private healthCallWarningTimeout: NodeJS.Timeout | null = null;
  private signalHandler: any;
  private connectionChangedHandler: any;
  private messageUpdatedHandler: any;
  private isOffline: boolean = false;

  constructor(client: ErmisChat<ErmisChatGenerics>, sessionID: string) {
    this._client = client;
    this.cid = '';
    this.callType = '';
    this.sessionID = sessionID;
    this.userID = client.userID;

    this.listenSocketEvents();
  }

  getClient(): ErmisChat<ErmisChatGenerics> {
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
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    if (this.onLocalStream) {
      this.onLocalStream(stream);
    }
    this.localStream = stream;
    return stream;
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

  createPeer(initiator: boolean) {
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
    this.peer = new SimplePeer({
      initiator,
      trickle: true,
      stream: this.localStream || undefined,
      config: {
        iceServers: ICE_SERVERS,
      },
      channelName: 'rtc_data_channel',
      allowHalfTrickle: true,
    });

    this.peer.on('signal', async (data: SimplePeerSignalData) => {
      let signal: any = null;
      if (data.type === 'offer') {
        signal = data;
      } else if (data.type === 'answer') {
        signal = data;
      } else if (data.type === 'candidate') {
        const sdp = `${data.candidate.sdpMid}$${data.candidate.sdpMLineIndex}$${data.candidate.candidate}`;
        signal = { type: 'ice', sdp };
      }

      // Send signal to server
      await this.signalCall(signal);
    });

    this.peer.on('connect', async () => {
      const jsonData = {
        type: 'transciver_state',
        body: {
          audio_enable: true,
          video_enable: this.callType === 'video',
        },
      };

      this.peer?.send(JSON.stringify(jsonData));

      await this.connectCall();
      this.setCallStatus(CallStatus.CONNECTED);

      // Clear missCall timeout when connected
      if (this.missCallTimeout) {
        clearTimeout(this.missCallTimeout);
        this.missCallTimeout = null;
      }

      // Set up health_call interval via WebRTC every 1s
      if (this.healthCallInterval) clearInterval(this.healthCallInterval);
      this.healthCallInterval = setInterval(() => {
        if (this.peer) {
          this.peer.send(JSON.stringify({ type: 'health_call' }));
        }
      }, 1000);

      // Set up healthCall interval via server every 10s
      if (this.healthCallServerInterval) clearInterval(this.healthCallServerInterval);
      this.healthCallServerInterval = setInterval(() => {
        this.healthCall();
      }, 10000);
    });

    this.peer.on('data', (data) => {
      const message = JSON.parse(data);

      if (typeof this.onDataChannelMessage === 'function') {
        this.onDataChannelMessage(message);
      }

      if (message.type === 'transciver_state') {
        const remoteVideoEnable = message.body.video_enable;
        const remoteAudioEnable = message.body.audio_enable;
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
    });

    this.peer.on('stream', (stream: MediaStream) => {
      this.remoteStream = stream;
      if (this.onRemoteStream) {
        this.onRemoteStream(stream);
      }
    });

    this.peer.on('error', (err) => {
      this.setCallStatus(CallStatus.ERROR);
      this.cleanupCall();
      console.error('SimplePeer error:', err);
    });

    // this.peer.on('close', () => {
    //   this.peer = null;
    //   this.callStatus = CallStatus.ENDED;
    // });
  }

  async makeOffer() {
    this.createPeer(true); // initiator = true
  }

  async handleOffer(offer: SimplePeerSignalData) {
    this.createPeer(false); // initiator = false
    if (this.peer) {
      this.peer.signal(offer);
    }
  }

  async handleAnswer(answer: SimplePeerSignalData) {
    if (this.peer) {
      this.peer.signal(answer);
    }
  }

  async handleIceCandidate(candidate: any) {
    if (this.peer) {
      this.peer.signal(candidate);
    }
  }

  listenSocketEvents() {
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
              // Receiver: receive offer, create peer, send answer and ice to caller
              await this.handleOffer(signalObj as SimplePeerSignalData);
            } else if (signalObj.type === 'answer') {
              // Caller: receive answer, establish connection
              await this.handleAnswer(signalObj as SimplePeerSignalData);
            } else if (signalObj.type === 'ice' && 'sdp' in signalObj) {
              // Both sides: receive ICE candidate
              const sdp = signalObj.sdp;
              const splitSdp = sdp.split('$');

              await this.handleIceCandidate({
                candidate: {
                  candidate: splitSdp[2],
                  sdpMLineIndex: Number(splitSdp[1]),
                  sdpMid: splitSdp[0],
                },
                type: 'candidate',
              });
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
              if (this.peer) {
                this.peer.send(JSON.stringify({ type: 'health_call' }));
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
        }

        if (upgradeUserId === this.userID) {
          const jsonData = {
            type: 'transciver_state',
            body: {
              audio_enable: this.localStream?.getAudioTracks().some((track) => track.enabled),
              video_enable: true,
            },
          };

          this.peer?.send(JSON.stringify(jsonData));
        }
      }
    };

    this._client.on('signal', this.signalHandler);
    this._client.on('connection.changed', this.connectionChangedHandler);
    this._client.on('message.updated', this.messageUpdatedHandler);
  }

  private cleanupCall() {
    // Clean up peer
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
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

  destroy() {
    // if (this.signalHandler) this._client.off('signal', this.signalHandler);
    // if (this.connectionChangedHandler) this._client.off('connection.changed', this.connectionChangedHandler);
    // if (this.messageUpdatedHandler) this._client.off('message.updated', this.messageUpdatedHandler);
    this.cleanupCall();
  }

  async createCall(callType: string, cid: string) {
    return await this._sendSignal({ action: CallAction.CREATE_CALL, cid, is_video: callType === 'video' });
  }

  async acceptCall() {
    return await this._sendSignal({ action: CallAction.ACCEPT_CALL });
  }

  async signalCall(signal: any) {
    return await this._sendSignal({ action: CallAction.SIGNAL_CALL, signal });
  }

  async endCall() {
    return await this._sendSignal({ action: CallAction.END_CALL });
  }

  async rejectCall() {
    return await this._sendSignal({ action: CallAction.REJECT_CALL });
  }

  async missCall() {
    return await this._sendSignal({ action: CallAction.MISS_CALL });
  }

  async connectCall() {
    return await this._sendSignal({ action: CallAction.CONNECT_CALL });
  }

  async healthCall() {
    return await this._sendSignal({ action: CallAction.HEALTH_CALL });
  }

  async upgradeCall() {
    if (this.callType === 'audio') {
      return await this._sendSignal({ action: CallAction.UPGRADE_CALL });
    }
    return null;
  }

  async startScreenShare() {
    if (!navigator.mediaDevices.getDisplayMedia) {
      throw new Error('Screen sharing is not supported in this browser.');
    }
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
      const sender = (this.peer as any)._pc.getSenders().find((s: RTCRtpSender) => s.track && s.track.kind === 'video');
      if (sender) {
        await sender.replaceTrack(screenTrack);
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
  }

  async stopScreenShare() {
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

    // Replace video track in peer connection
    if (this.peer) {
      const sender = (this.peer as any)._pc.getSenders().find((s: RTCRtpSender) => s.track && s.track.kind === 'video');
      if (sender) {
        await sender.replaceTrack(cameraTrack);
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
  }

  toggleMic(enabled: boolean) {
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((track) => {
        track.enabled = enabled;
      });

      if (this.peer) {
        this.peer.send(
          JSON.stringify({
            type: 'transciver_state',
            body: {
              audio_enable: enabled,
              video_enable: this.localStream.getVideoTracks().some((track) => track.enabled),
            },
          }),
        );
      }
    }
  }

  toggleCamera(enabled: boolean) {
    if (this.localStream) {
      this.localStream.getVideoTracks().forEach((track) => {
        track.enabled = enabled;
      });

      if (this.peer) {
        this.peer.send(
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
}
