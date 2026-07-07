import { v4 as uuidv4 } from 'uuid';
import AbstractSession from './AbstractSession.ts';
import Envelope from './Envelope.ts';

export default class WebSocketSession extends AbstractSession {
    private ws: WebSocket | null = null;
    private myId = '';
    private roomCode = '';
    
    // Deployed Render service URL for our custom signaling backend
    private serverUrl = 'wss://syncplay-backend.onrender.com';

    constructor() {
        super();
        this.myId = uuidv4();
    }



    getId(): string {
        return this.myId;
    }

    getRoomKey(): string {
        return this.myId;
    }

    async connect(roomCode: string): Promise<boolean> {
        this.roomCode = roomCode;

        // If running locally, check if local server is active, otherwise check url query parameter, env variable, and fallback
        const isLocal = typeof window === 'undefined' || (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
        
        const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
        const queryServer = params.get('server');
        const envServer = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_SIGNALING_SERVER : undefined;
        
        const url = isLocal 
            ? 'ws://localhost:8080' 
            : (queryServer || envServer || this.serverUrl);

        return new Promise<boolean>((resolve, reject) => {
            try {
                const ws = new WebSocket(url);
                this.ws = ws;

                ws.onopen = () => {
                    // Register and join the room topic
                    ws.send(JSON.stringify({
                        type: 'JOIN',
                        roomId: roomCode,
                        clientId: this.myId,
                        nickname: this.name
                    }));
                    this.connected = true;
                    resolve(true);
                };

                ws.onmessage = (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        
                        if (data.type === 'PEER_JOIN') {
                            this.onEnvelope({
                                senderId: data.senderId,
                                payload: {
                                    type: 'JOIN',
                                    nickname: data.nickname
                                }
                            });
                        } else if (data.type === 'PEER_LEAVE') {
                            this.onEnvelope({
                                senderId: data.senderId,
                                payload: {
                                    type: 'CHAT',
                                    msg: {
                                        id: Math.random().toString(36).substring(2, 9),
                                        sender: 'System',
                                        text: `${data.nickname} left the session.`,
                                        system: true,
                                        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                                    }
                                }
                            });
                        } else if (data.type === 'CHAT') {
                            this.onEnvelope({
                                senderId: data.senderId,
                                payload: {
                                    type: 'CHAT',
                                    msg: data.payload
                                }
                            });
                        } else if (data.type === 'SYNC') {
                            this.onEnvelope({
                                senderId: data.senderId,
                                payload: {
                                    type: 'SYNC',
                                    paused: data.payload.paused,
                                    position: data.payload.position
                                }
                            });
                        } else if (data.type === 'SIGNAL') {
                            const innerPayload = data.payload;
                            if (innerPayload && innerPayload.type === 'STATE') {
                                this.onEnvelope({
                                    senderId: data.senderId,
                                    payload: {
                                        type: 'STATE',
                                        paused: innerPayload.paused,
                                        position: innerPayload.position,
                                        roomName: innerPayload.roomName,
                                        participants: innerPayload.participants
                                    }
                                });
                            } else if (innerPayload && innerPayload.type === 'STATE_CHANGE') {
                                this.onEnvelope({
                                    senderId: data.senderId,
                                    payload: {
                                        type: 'STATE_CHANGE',
                                        paused: innerPayload.paused,
                                        position: innerPayload.position
                                    }
                                });
                            } else {
                                this.onEnvelope({
                                    senderId: data.senderId,
                                    payload: innerPayload
                                });
                            }
                        }
                    } catch (e) {
                        console.error('Failed to parse websocket message:', e);
                    }
                };

                ws.onerror = (err) => {
                    this.connected = false;
                    reject(err);
                };

                ws.onclose = () => {
                    this.connected = false;
                };
            } catch (e) {
                reject(e);
            }
        });
    }

    async send(envelope: Envelope, destinationId: string): Promise<boolean> {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            return false;
        }

        const payload = envelope.payload;
        
        if (payload.type === 'JOIN') {
            // Already handled in connect() by JOIN frame
            return true;
        } else if (payload.type === 'STATE') {
            this.ws.send(JSON.stringify({
                type: 'SIGNAL',
                roomId: this.roomCode,
                destinationId,
                payload: {
                    type: 'STATE',
                    paused: payload.paused,
                    position: payload.position,
                    roomName: payload.roomName,
                    participants: payload.participants
                }
            }));
            return true;
        } else if (payload.type === 'CHAT') {
            this.ws.send(JSON.stringify({
                type: 'CHAT',
                roomId: this.roomCode,
                payload: payload.msg
            }));
            return true;
        } else if (payload.type === 'SYNC') {
            this.ws.send(JSON.stringify({
                type: 'SYNC',
                roomId: this.roomCode,
                payload: {
                    paused: payload.paused,
                    position: payload.position
                }
            }));
            return true;
        } else if (payload.type === 'STATE_CHANGE') {
            this.ws.send(JSON.stringify({
                type: 'SIGNAL',
                roomId: this.roomCode,
                destinationId,
                payload: {
                    type: 'STATE_CHANGE',
                    paused: payload.paused,
                    position: payload.position
                }
            }));
            return true;
        }

        // Fallback for custom/untyped payloads (useful for tests)
        this.ws.send(JSON.stringify({
            type: 'SIGNAL',
            roomId: this.roomCode,
            destinationId,
            payload: payload
        }));
        return true;
    }

    destroy() {
        this.ws?.close();
        this.connected = false;
    }
}
