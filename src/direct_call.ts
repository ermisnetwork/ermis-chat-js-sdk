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
  // IDLE = 'idle',
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
  cid: string;
  callType: string;
  sessionID: string;
  userID: string | undefined;
  callStatus = '';
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

  private missCallTimeout: NodeJS.Timeout | null = null;
  private healthCallInterval: NodeJS.Timeout | null = null;
  private healthCallServerInterval: NodeJS.Timeout | null = null;
  private healthCallTimeout: NodeJS.Timeout | null = null;
  private healthCallWarningTimeout: NodeJS.Timeout | null = null;
  private signalHandler: any;
  private connectionChangedHandler: any;
  private messageUpdatedHandler: any;

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
    return await this.getClient().post(this.getClient().baseURL + '/signal', {
      ...payload,
      cid: this.cid || payload.cid,
      is_video: this.callType === 'video' || payload.is_video,
      ios: false,
      session_id: this.sessionID,
    });
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

    // Lấy userId của caller và receiver từ activeChannels
    const channel = cid ? this.getClient().activeChannels[cid] : undefined;
    const members = channel?.state?.members || {};
    const memberIds = Object.keys(members);

    // callerId là eventUserId, receiverId là user còn lại trong channel
    const callerId = eventUserId || '';
    const receiverId = memberIds.find((id) => id !== callerId) || '';

    // Lấy thông tin từ client.state.users
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

      // Gửi signal qua server
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

      // Xóa missCall timeout khi đã kết nối
      if (this.missCallTimeout) {
        clearTimeout(this.missCallTimeout);
        this.missCallTimeout = null;
      }

      // Thiết lập health_call interval qua WebRTC mỗi 1s
      if (this.healthCallInterval) clearInterval(this.healthCallInterval);
      this.healthCallInterval = setInterval(() => {
        if (this.peer) {
          this.peer.send(JSON.stringify({ type: 'health_call' }));
        }
      }, 1000);

      // Thiết lập healthCall interval qua server mỗi 10s
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

      // Xử lý health_call
      if (message.type === 'health_call') {
        // Reset timeout mỗi khi nhận được health_call
        if (this.healthCallTimeout) clearTimeout(this.healthCallTimeout);
        this.healthCallTimeout = setTimeout(async () => {
          // Nếu sau 30s không nhận được health_call thì kết thúc cuộc gọi
          await this.endCall();
        }, 30000);

        // Reset cảnh báo mất kết nối đối phương
        if (this.healthCallWarningTimeout) clearTimeout(this.healthCallWarningTimeout);
        this.setConnectionMessage(null);

        // Nếu không nhận được health_call sau 3s thì cảnh báo đối phương mất mạng
        this.healthCallWarningTimeout = setTimeout(() => {
          this.setConnectionMessage(`Remote user network connection is unstable`);
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
          this.setUserInfo(cid, eventUserId);
          this.setCallStatus(CallStatus.RINGING);
          this.callType = is_video ? 'video' : 'audio';
          this.cid = cid || '';
          await this.startLocalStream({ audio: true, video: true });
          if (typeof this.onCallEvent === 'function') {
            if (eventUserId !== this.userID) {
              // Cuộc gọi đến
              this.onCallEvent({
                type: 'incoming',
                // callerId: eventUserId || '',
                callType: is_video ? 'video' : 'audio',
                cid: cid || '',
                callerInfo: this.callerInfo,
                receiverInfo: this.receiverInfo,
              });
            } else {
              this.onCallEvent({
                type: 'outgoing',
                // callerId: eventUserId || '',
                callType: is_video ? 'video' : 'audio',
                cid: cid || '',
                callerInfo: this.callerInfo,
                receiverInfo: this.receiverInfo,
              });
            }
          }
          // Thiết lập timeout missCall nếu sau 60s không có kết nối
          if (this.missCallTimeout) clearTimeout(this.missCallTimeout);
          this.missCallTimeout = setTimeout(async () => {
            await this.missCall();
          }, 60000);
          break;

        case CallAction.ACCEPT_CALL:
          if (eventUserId !== this.userID) {
            // Caller: khi receiver accept, tạo offer gửi cho receiver
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
              // Receiver: nhận offer, tạo peer, gửi answer và ice cho caller
              await this.handleOffer(signalObj as SimplePeerSignalData);
            } else if (signalObj.type === 'answer') {
              // Caller: nhận answer, thiết lập kết nối
              await this.handleAnswer(signalObj as SimplePeerSignalData);
            } else if (signalObj.type === 'ice' && 'sdp' in signalObj) {
              // Cả 2 bên: nhận ICE candidate
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
      if (!online) {
        this.setConnectionMessage('Your network connection is unstable');
      } else {
        this.setConnectionMessage(null);
      }
    };
    this.messageUpdatedHandler = (event: Event<ErmisChatGenerics>) => {
      if (this.callStatus === CallStatus.CONNECTED && event.cid === this.cid) {
        if (event.user?.id === this.userID) {
          const jsonData = {
            type: 'transciver_state',
            body: {
              audio_enable: true,
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
    // Dọn dẹp peer
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
    // Dừng local stream nếu có
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }
    // Dọn dẹp missCall timeout
    if (this.missCallTimeout) {
      clearTimeout(this.missCallTimeout);
      this.missCallTimeout = null;
    }
    // Dọn dẹp healthCall interval qua WebRTC
    if (this.healthCallInterval) {
      clearInterval(this.healthCallInterval);
      this.healthCallInterval = null;
    }
    // Dọn dẹp healthCall interval qua server
    if (this.healthCallServerInterval) {
      clearInterval(this.healthCallServerInterval);
      this.healthCallServerInterval = null;
    }
    // Dọn dẹp healthCall timeout
    if (this.healthCallTimeout) {
      clearTimeout(this.healthCallTimeout);
      this.healthCallTimeout = null;
    }
    // Dọn dẹp healthCall warning timeout
    if (this.healthCallWarningTimeout) {
      clearTimeout(this.healthCallWarningTimeout);
      this.healthCallWarningTimeout = null;
    }
    this.setConnectionMessage(null);
  }

  destroy() {
    if (this.signalHandler) this._client.off('signal', this.signalHandler);
    if (this.connectionChangedHandler) this._client.off('connection.changed', this.connectionChangedHandler);
    if (this.messageUpdatedHandler) this._client.off('message.updated', this.messageUpdatedHandler);
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

    // Thay thế video track trong localStream
    if (this.localStream) {
      // Dừng track cũ
      this.localStream.getVideoTracks().forEach((track) => track.stop());
      // Thêm track mới vào localStream
      this.localStream.removeTrack(this.localStream.getVideoTracks()[0]);
      this.localStream.addTrack(screenTrack);
    } else {
      // Nếu chưa có localStream, tạo mới
      this.localStream = screenStream;
    }

    // Thay thế video track trong peer connection

    if (this.peer) {
      const sender = (this.peer as any)._pc.getSenders().find((s: RTCRtpSender) => s.track && s.track.kind === 'video');
      if (sender) {
        await sender.replaceTrack(screenTrack);
      }
    }

    // Khi dừng chia sẻ màn hình, tự động revert về camera
    screenTrack.onended = () => {
      this.stopScreenShare();
    };

    // Gọi callback nếu cần cập nhật UI
    if (this.onLocalStream) {
      this.onLocalStream(this.localStream);
    }
  }

  async stopScreenShare() {
    // Lấy lại camera stream
    const cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    const cameraTrack = cameraStream.getVideoTracks()[0];

    // Thay thế video track trong localStream
    if (this.localStream) {
      // Dừng track cũ (screen)
      this.localStream.getVideoTracks().forEach((track) => track.stop());
      // Thay thế bằng camera track
      this.localStream.removeTrack(this.localStream.getVideoTracks()[0]);
      this.localStream.addTrack(cameraTrack);
    } else {
      this.localStream = cameraStream;
    }

    // Thay thế video track trong peer connection
    if (this.peer) {
      const sender = (this.peer as any)._pc.getSenders().find((s: RTCRtpSender) => s.track && s.track.kind === 'video');
      if (sender) {
        await sender.replaceTrack(cameraTrack);
      }
    }

    // Gọi callback nếu cần cập nhật UI
    if (this.onLocalStream) {
      this.onLocalStream(this.localStream);
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
