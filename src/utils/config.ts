export interface IceServerSettings {
  enabled: boolean;
  servers: RTCIceServer[];
}

export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [];
