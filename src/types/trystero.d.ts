declare module 'trystero/torrent' {
  export type Room = any;
  export function joinRoom(config: any, roomId: string): Room;
}
