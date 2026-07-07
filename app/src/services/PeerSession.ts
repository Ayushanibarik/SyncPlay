import AbstractSession from './AbstractSession.ts';
import Envelope from './Envelope.ts';

declare const Peer: any;

export default class PeerSession extends AbstractSession {
    private peer: any = null;
    private connections = new Map<string, any>();
    private myId = '';
    private roomCode = '';
    private isHost = false;

    constructor() {
        super();
        this.myId = Math.random().toString(36).substring(2, 10);
    }

    getId(): string {
        return this.myId;
    }

    getRoomKey(): string {
        return this.myId;
    }

    async connect(roomCode: string): Promise<boolean> {
        this.roomCode = roomCode;
        this.isHost = (roomCode === this.myId);

        return new Promise<boolean>((resolve, reject) => {
            try {
                this.peer = new Peer(this.isHost ? this.myId : undefined);

                this.peer.on('open', (id: string) => {
                    if (!this.isHost) {
                        this.myId = id;
                    }
                    this.connected = true;

                    if (this.isHost) {
                        resolve(true);
                    } else {
                        const conn = this.peer.connect(roomCode);
                        this.setupConnection(conn, resolve, reject);
                    }
                });

                this.peer.on('connection', (conn: any) => {
                    this.setupConnection(conn);
                });

                this.peer.on('error', (err: any) => {
                    console.error('PeerJS error:', err);
                    this.connected = false;
                    reject(err);
                });

                this.peer.on('close', () => {
                    this.connected = false;
                });
            } catch (e) {
                reject(e);
            }
        });
    }

    private setupConnection(conn: any, resolve?: (v: boolean) => void, reject?: (err: any) => void) {
        conn.on('open', () => {
            const peerId = conn.peer;
            this.connections.set(peerId, conn);

            if (!this.isHost) {
                conn.send({
                    senderId: this.myId,
                    payload: {
                        type: 'JOIN',
                        nickname: this.name
                    }
                });
            }

            if (resolve) resolve(true);
        });

        conn.on('data', (data: any) => {
            try {
                if (data && data.payload) {
                    this.onEnvelope(data);
                }
            } catch (e) {
                console.error('Error handling PeerJS data:', e);
            }
        });

        conn.on('close', () => {
            const peerId = conn.peer;
            this.connections.delete(peerId);

            this.onEnvelope({
                senderId: peerId,
                payload: {
                    type: 'CHAT',
                    msg: {
                        id: Math.random().toString(36).substring(2, 9),
                        sender: 'System',
                        text: `A peer disconnected from the session.`,
                        system: true,
                        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    }
                }
            });
        });

        conn.on('error', (err: any) => {
            console.error('Connection error:', err);
            if (reject) reject(err);
        });
    }

    async send(envelope: Envelope, destinationId: string): Promise<boolean> {
        envelope.senderId = this.myId;

        if (this.isHost) {
            if (destinationId === 'all') {
                this.connections.forEach(conn => {
                    if (conn.open) {
                        conn.send(envelope);
                    }
                });
                return true;
            } else {
                const conn = this.connections.get(destinationId);
                if (conn && conn.open) {
                    conn.send(envelope);
                    return true;
                }
            }
        } else {
            const conn = this.connections.get(this.roomCode) || this.connections.get(destinationId);
            if (conn && conn.open) {
                conn.send(envelope);
                return true;
            } else {
                let sent = false;
                this.connections.forEach(c => {
                    if (c.open && !sent) {
                        c.send(envelope);
                        sent = true;
                    }
                });
                return sent;
            }
        }
        return false;
    }

    destroy() {
        this.connections.forEach(conn => conn.close());
        this.connections.clear();
        this.peer?.destroy();
        this.connected = false;
    }
}
