import React, { useEffect, useRef, useState } from "react";
import { SessionManager, AbstractSession } from "../services";
import { Role } from "../model/Role";
import Envelope from "../services/Envelope";

interface TheaterProps {
    sessionConfig: {
        role: string;
        nickname: string;
        roomCode: string;
        roomName: string;
        videoInfo: {
            fileObj: string;
            name: string;
        };
    };
}

interface ChatMessage {
    id: string;
    sender: string;
    text: string;
    system: boolean;
    timestamp: string;
}

export default function Theater({ sessionConfig }: TheaterProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const sessionRef = useRef<AbstractSession | null>(null);
    const participantsSetRef = useRef<Set<string>>(new Set());
    const participantsNamesMapRef = useRef<Map<string, string>>(new Map());
    const isSyncingRef = useRef<boolean>(false);

    const [roomCode, setRoomCode] = useState<string>(sessionConfig.roomCode);
    const [roomName, setRoomName] = useState<string>(sessionConfig.roomName);
    const [copied, setCopied] = useState<boolean>(false);
    const [codeCopied, setCodeCopied] = useState<boolean>(false);
    const [participants, setParticipants] = useState<string[]>([sessionConfig.nickname]);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [inputText, setInputText] = useState<string>("");

    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Auto scroll chat to bottom
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    // Initialize session connection
    useEffect(() => {
        let active = true;

        async function initSession() {
            try {
                const session = SessionManager.create({ name: sessionConfig.nickname });
                sessionRef.current = session;
                await session.setup();

                if (!active) return;

                if (sessionConfig.role === Role.OWNER) {
                    const hostId = session.getId();
                    await session.connect(hostId);
                    setRoomCode(hostId);

                    // Update URL with code parameter so owner can share easily
                    const newUrl = `${window.location.origin}${window.location.pathname}?code=${hostId}`;
                    window.history.replaceState(null, "", newUrl);

                    addSystemMessage("Session created. Share the link below with your friends!");
                } else {
                    await session.connect(sessionConfig.roomCode);
                    // Send JOIN message to Host
                    await session.send({
                        payload: {
                            type: "JOIN",
                            nickname: sessionConfig.nickname
                        }
                    }, sessionConfig.roomCode);

                    addSystemMessage(`Connecting to room ${sessionConfig.roomCode}...`);
                }

                session.onEnvelope = (envelope: Envelope) => {
                    const { type, nickname, paused, position, roomName: rName, participants: parts, msg } = envelope.payload;
                    const senderId = envelope.senderId || "";

                    if (type === "JOIN" && sessionConfig.role === Role.OWNER) {
                        // Register participant
                        participantsSetRef.current.add(senderId);
                        participantsNamesMapRef.current.set(senderId, nickname);
                        
                        const list = [sessionConfig.nickname, ...Array.from(participantsNamesMapRef.current.values())];
                        setParticipants(list);

                        // Notify all other participants of the new arrival
                        const joinAlert: ChatMessage = {
                            id: Math.random().toString(36).substring(2, 9),
                            sender: "System",
                            text: `${nickname} joined the session.`,
                            system: true,
                            timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                        };
                        setMessages(prev => [...prev, joinAlert]);

                        // Send STATE to the new joiner
                        session.send({
                            payload: {
                                type: "STATE",
                                paused: videoRef.current ? videoRef.current.paused : true,
                                position: videoRef.current ? videoRef.current.currentTime : 0,
                                roomName: roomName,
                                participants: list
                            }
                        }, senderId);

                        // Broadcast JOIN notification to other viewers
                        participantsSetRef.current.forEach(viewerId => {
                            if (viewerId !== senderId) {
                                session.send({
                                    payload: {
                                        type: "CHAT",
                                        msg: joinAlert
                                    }
                                }, viewerId);
                            }
                        });
                    } else if (type === "STATE" && sessionConfig.role === Role.VIEWER) {
                        setRoomName(rName);
                        if (parts) setParticipants(parts);

                        // Sync local video
                        if (videoRef.current) {
                            isSyncingRef.current = true;
                            videoRef.current.currentTime = position;
                            if (paused) {
                                videoRef.current.pause();
                            } else {
                                videoRef.current.play().catch(() => {});
                            }
                            setTimeout(() => { isSyncingRef.current = false; }, 300);
                        }

                        addSystemMessage(`Joined watch party: "${rName}"`);
                    } else if (type === "SYNC" && sessionConfig.role === Role.VIEWER) {
                        // Sync local video state from Host
                        if (videoRef.current) {
                            isSyncingRef.current = true;
                            videoRef.current.currentTime = position;
                            if (paused) {
                                videoRef.current.pause();
                            } else {
                                videoRef.current.play().catch(() => {});
                            }
                            setTimeout(() => { isSyncingRef.current = false; }, 300);
                        }
                    } else if (type === "STATE_CHANGE" && sessionConfig.role === Role.OWNER) {
                        // Viewer requested play/pause/seek state change
                        if (videoRef.current) {
                            isSyncingRef.current = true;
                            videoRef.current.currentTime = position;
                            if (paused) {
                                videoRef.current.pause();
                            } else {
                                videoRef.current.play().catch(() => {});
                            }
                            setTimeout(() => { isSyncingRef.current = false; }, 300);
                        }

                        const viewerName = participantsNamesMapRef.current.get(senderId) || "A viewer";
                        addSystemMessage(`${viewerName} synced playback state.`);

                        // Broadcast SYNC to all other viewers
                        participantsSetRef.current.forEach(viewerId => {
                            session.send({
                                payload: {
                                    type: "SYNC",
                                    paused,
                                    position
                                }
                            }, viewerId);
                        });
                    } else if (type === "CHAT") {
                        setMessages(prev => [...prev, msg]);

                        // Owner forwards message to all other viewers
                        if (sessionConfig.role === Role.OWNER) {
                            participantsSetRef.current.forEach(viewerId => {
                                if (viewerId !== senderId) {
                                    session.send({
                                        payload: {
                                            type: "CHAT",
                                            msg
                                        }
                                    }, viewerId);
                                }
                            });
                        }
                    }
                };

            } catch (err) {
                console.error("Failed to initialize session:", err);
                addSystemMessage("Error: Failed to connect to communication broker.");
            }
        }

        initSession();

        return () => {
            active = false;
            sessionRef.current?.destroy();
        };
    }, []);

    // Broadcast local video play/pause/seek events to peers
    const handleVideoEvent = () => {
        if (!videoRef.current || !sessionRef.current) return;
        if (isSyncingRef.current) return;

        const paused = videoRef.current.paused;
        const position = videoRef.current.currentTime;

        if (sessionConfig.role === Role.OWNER) {
            // Broadcast state to all viewers
            participantsSetRef.current.forEach(viewerId => {
                sessionRef.current?.send({
                    payload: {
                        type: "SYNC",
                        paused,
                        position
                    }
                }, viewerId);
            });
        } else {
            // Send state change to Host
            sessionRef.current.send({
                payload: {
                    type: "STATE_CHANGE",
                    paused,
                    position
                }
            }, sessionConfig.roomCode);
        }
    };

    useEffect(() => {
        const video = videoRef.current;
        if (video) {
            video.addEventListener("play", handleVideoEvent);
            video.addEventListener("pause", handleVideoEvent);
            video.addEventListener("seeked", handleVideoEvent);
        }
        return () => {
            if (video) {
                video.removeEventListener("play", handleVideoEvent);
                video.removeEventListener("pause", handleVideoEvent);
                video.removeEventListener("seeked", handleVideoEvent);
            }
        };
    }, [roomCode]);

    const addSystemMessage = (text: string) => {
        setMessages(prev => [
            ...prev,
            {
                id: Math.random().toString(36).substring(2, 9),
                sender: "System",
                text,
                system: true,
                timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
            }
        ]);
    };

    const copyInviteLink = () => {
        const inviteLink = `${window.location.origin}${window.location.pathname}?code=${roomCode}`;
        navigator.clipboard.writeText(inviteLink).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    const copyRoomCode = () => {
        navigator.clipboard.writeText(roomCode).then(() => {
            setCodeCopied(true);
            setTimeout(() => setCodeCopied(false), 2000);
        });
    };

    const sendChatMessage = (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!inputText.trim() || !sessionRef.current) return;

        const text = inputText.trim();
        setInputText("");

        const newMsg: ChatMessage = {
            id: Math.random().toString(36).substring(2, 9),
            sender: sessionConfig.nickname,
            text: text,
            system: false,
            timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        };

        setMessages(prev => [...prev, newMsg]);

        if (sessionConfig.role === Role.OWNER) {
            participantsSetRef.current.forEach(viewerId => {
                sessionRef.current?.send({
                    payload: {
                        type: "CHAT",
                        msg: newMsg
                    }
                }, viewerId);
            });
        } else {
            sessionRef.current.send({
                payload: {
                    type: "CHAT",
                    msg: newMsg
                }
            }, sessionConfig.roomCode);
        }
    };

    return (
        <div className="theater-container">
            {/* Left Column: Video Player */}
            <div className="video-pane">
                <video ref={videoRef} src={sessionConfig.videoInfo.fileObj} controls></video>
            </div>

            {/* Right Column: Chat & Session Info Sidebar */}
            <div className="sidebar-pane">
                <div className="sidebar-header">
                    <h2>{roomName || "Watch Party"}</h2>
                    <div className="room-meta">
                        <span className="room-badge">{sessionConfig.role}</span>
                        <button className="copy-link-btn" onClick={copyInviteLink}>
                            <span>🔗 Copy Invite Link</span>
                        </button>
                        <button className="copy-link-btn" onClick={copyRoomCode}>
                            <span>🔑 Copy Room Code</span>
                        </button>
                        {(copied || codeCopied) && (
                            <span className="copy-feedback">
                                {copied ? "Link Copied!" : "Code Copied!"}
                            </span>
                        )}
                    </div>
                </div>

                <div className="participants-section">
                    <span className="bento-label">Peers Connected</span>
                    <div className="participants-list">
                        {participants.map((p, idx) => (
                            <span key={idx} className="participant-badge">
                                👤 {p}
                            </span>
                        ))}
                    </div>
                </div>

                <div className="chat-section">
                    <div className="messages-list" id="messagesList">
                        {messages.map(msg => (
                            msg.system ? (
                                <div key={msg.id} className="message-system">
                                    {msg.text}
                                </div>
                            ) : (
                                <div key={msg.id} className={`chat-message ${msg.sender === sessionConfig.nickname ? "chat-message--self" : ""}`}>
                                    <span className="message-header">
                                        {msg.sender} <span style={{ fontSize: "0.6rem", color: "#64748b", fontWeight: "normal" }}>({msg.timestamp})</span>
                                    </span>
                                    <span className="message-text">{msg.text}</span>
                                </div>
                            )
                        ))}
                        <div ref={messagesEndRef} />
                    </div>

                    <form className="chat-input-wrapper" onSubmit={sendChatMessage}>
                        <input
                            type="text"
                            placeholder="Send a message..."
                            value={inputText}
                            onChange={e => setInputText(e.target.value)}
                            className="chat-input"
                            id="chat-input"
                        />
                        <button type="submit" className="chat-send-btn">
                            Send
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
}
