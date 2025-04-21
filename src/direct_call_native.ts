import { ErmisChat } from './client';
import { DefaultGenerics, Event, ExtendableGenerics, SignalData } from './types';
import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  mediaDevices,
  MediaStream,
} from 'react-native-webrtc';

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

type MediaStreamConstraints = {
  audio?: boolean;
  video?: boolean;
};

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

export class ErmisDirectCallNative<ErmisChatGenerics extends ExtendableGenerics = DefaultGenerics> {
  _client: ErmisChat<ErmisChatGenerics>;
  sessionID: string;
  cid?: string;
  callType?: string;
  userID?: string | undefined;
  callStatus? = '';
  peer?: RTCPeerConnection | null = null;
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

  private missCallTimeout: ReturnType<typeof setTimeout> | null = null;
  private healthCallInterval: ReturnType<typeof setInterval> | null = null;
  private healthCallServerInterval: ReturnType<typeof setInterval> | null = null;
  private healthCallTimeout: ReturnType<typeof setTimeout> | null = null;
  private healthCallWarningTimeout: ReturnType<typeof setTimeout> | null = null;
  private signalHandler: any;
  private connectionChangedHandler: any;
  private messageUpdatedHandler: any;
  private isOffline: boolean = false;
  private dataChannel: any = null;

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
          if (error.response?.data?.ermis_code === 20) {
            this.onError('Recipient was busy');
          } else {
            this.onError('Call Failed');
          }
        }
      }
    }
  }

  async startLocalStream(constraints: MediaStreamConstraints = { audio: true, video: true }) {
    const stream = await mediaDevices.getUserMedia(constraints);
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
    const channel = cid ? this.getClient().activeChannels[cid] : undefined;
    const members = channel?.state?.members || {};
    const memberIds = Object.keys(members);
    const callerId = eventUserId || '';
    const receiverId = memberIds.find((id) => id !== callerId) || '';
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
      this.peer.close();
      this.peer = null;
    }
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.peer = pc;

    // Add local stream tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach((track: any) => {
        pc.addTrack(track, this.localStream!);
      });
    }

    // Data channel
    if (initiator) {
      this.dataChannel = pc.createDataChannel('rtc_data_channel');
      this.setupDataChannel(this.dataChannel);
    } else {
      (pc as any).ondatachannel = (event: any) => {
        this.dataChannel = event.channel;
        this.setupDataChannel(this.dataChannel);
      };
    }

    // ICE candidates
    (pc as any).onicecandidate = async (event: any) => {
      if (event.candidate) {
        await this.signalCall({
          type: 'ice',
          sdp: JSON.stringify(event.candidate),
        });
      }
    };

    // Remote stream
    (pc as any).ontrack = (event: any) => {
      if (event.streams && event.streams[0]) {
        this.remoteStream = event.streams[0];
        if (this.onRemoteStream && this.remoteStream) {
          this.onRemoteStream(this.remoteStream);
        }
      }
    };

    // Connection state
    (pc as any).onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        this.setCallStatus(CallStatus.CONNECTED);
        if (this.missCallTimeout) {
          clearTimeout(this.missCallTimeout);
          this.missCallTimeout = null;
        }
        if (this.healthCallInterval) clearInterval(this.healthCallInterval);
        this.healthCallInterval = setInterval(() => {
          this.sendDataChannel({ type: 'health_call' });
        }, 1000);
        if (this.healthCallServerInterval) clearInterval(this.healthCallServerInterval);
        this.healthCallServerInterval = setInterval(() => {
          this.healthCall();
        }, 10000);
      } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        this.setCallStatus(CallStatus.ERROR);
        this.cleanupCall();
      }
    };
  }

  private setupDataChannel(channel: any) {
    if (!channel) return;
    channel.onmessage = (event: any) => {
      let message: any;
      try {
        message = JSON.parse(event.data);
      } catch {
        message = event.data;
      }
      if (typeof this.onDataChannelMessage === 'function') {
        this.onDataChannelMessage(message);
      }
      if (message.type === 'health_call') {
        if (this.healthCallTimeout) clearTimeout(this.healthCallTimeout);
        this.healthCallTimeout = setTimeout(async () => {
          await this.endCall();
        }, 30000);
        if (this.healthCallWarningTimeout) clearTimeout(this.healthCallWarningTimeout);
        this.setConnectionMessage(null);
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
    channel.onerror = (err: any) => {
      this.setCallStatus(CallStatus.ERROR);
      this.cleanupCall();
      console.error('DataChannel error:', err);
    };
  }

  private sendDataChannel(data: any) {
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      this.dataChannel.send(JSON.stringify(data));
    }
  }

  async makeOffer() {
    this.createPeer(true);
    if (!this.peer) return;
    const offer = await this.peer.createOffer({});
    await this.peer.setLocalDescription(offer);
    await this.signalCall(offer);
  }

  async handleOffer(offer: any) {
    this.createPeer(false);
    if (!this.peer) return;
    await this.peer.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await this.peer.createAnswer();
    await this.peer.setLocalDescription(answer);
    await this.signalCall(answer);
  }

  async handleAnswer(answer: any) {
    if (this.peer) {
      await this.peer.setRemoteDescription(new RTCSessionDescription(answer));
    }
  }

  async handleIceCandidate(candidate: any) {
    if (this.peer && candidate) {
      await this.peer.addIceCandidate(
        new RTCIceCandidate(typeof candidate === 'string' ? JSON.parse(candidate) : candidate),
      );
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
              this.onCallEvent({
                type: 'incoming',
                callType: is_video ? 'video' : 'audio',
                cid: cid || '',
                callerInfo: this.callerInfo,
                receiverInfo: this.receiverInfo,
              });
            } else {
              this.onCallEvent({
                type: 'outgoing',
                callType: is_video ? 'video' : 'audio',
                cid: cid || '',
                callerInfo: this.callerInfo,
                receiverInfo: this.receiverInfo,
              });
            }
          }
          if (this.missCallTimeout) clearTimeout(this.missCallTimeout);
          this.missCallTimeout = setTimeout(async () => {
            await this.missCall();
          }, 60000);
          break;

        case CallAction.ACCEPT_CALL:
          if (eventUserId !== this.userID) {
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
              await this.handleOffer(signalObj);
            } else if (signalObj.type === 'answer') {
              await this.handleAnswer(signalObj);
            } else if (signalObj.type === 'ice' && 'sdp' in signalObj) {
              await this.handleIceCandidate(signalObj.sdp);
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
        if (this.callStatus === CallStatus.CONNECTED && this.peer) {
          if (!this.healthCallInterval) {
            this.healthCallInterval = setInterval(() => {
              this.sendDataChannel({ type: 'health_call' });
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
          this.sendDataChannel({
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
    if (this.peer) {
      this.peer.close();
      this.peer = null;
    }
    if (this.localStream) {
      this.localStream.getTracks().forEach((track: any) => track.stop());
      this.localStream = null;
    }
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
  }

  destroy() {
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

  // Screen sharing is not natively supported in React Native WebRTC
  async startScreenShare() {
    throw new Error('Screen sharing is not supported in React Native WebRTC.');
  }

  async stopScreenShare() {
    throw new Error('Screen sharing is not supported in React Native WebRTC.');
  }

  toggleMic(enabled: boolean) {
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((track: any) => {
        track.enabled = enabled;
      });
      this.sendDataChannel({
        type: 'transciver_state',
        body: {
          audio_enable: enabled,
          video_enable: this.localStream.getVideoTracks().some((track: any) => track.enabled),
        },
      });
    }
  }

  toggleCamera(enabled: boolean) {
    if (this.localStream) {
      this.localStream.getVideoTracks().forEach((track: any) => {
        track.enabled = enabled;
      });
      this.sendDataChannel({
        type: 'transciver_state',
        body: {
          audio_enable: this.localStream.getAudioTracks().some((track: any) => track.enabled),
          video_enable: enabled,
        },
      });
    }
  }
}
