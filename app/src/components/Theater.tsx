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
        videoInfo?: {
            fileObj: string;
            name: string;
        } | null;
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
    const [localVideoInfo, setLocalVideoInfo] = useState(sessionConfig.videoInfo);
    const [incomingStream, setIncomingStream] = useState<MediaStream | null>(null);

    const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
    const hostStreamRef = useRef<MediaStream | null>(null);
    const viewerHasVideoMapRef = useRef<Map<string, boolean>>(new Map());

    const getHostStream = () => {
        if (!hostStreamRef.current && videoRef.current) {
            const videoEl = videoRef.current as any;
            if (videoEl.captureStream) {
                hostStreamRef.current = videoEl.captureStream();
            } else if (videoEl.mozCaptureStream) {
                hostStreamRef.current = videoEl.mozCaptureStream();
            }
        }
        return hostStreamRef.current;
    };

    const getOrCreatePeerConnection = (peerId: string) => {
        if (peerConnectionsRef.current.has(peerId)) {
            return peerConnectionsRef.current.get(peerId)!;
        }

        const pc = new RTCPeerConnection({
            iceServers: [
                { urls: "stun:stun.l.google.com:19302" },
                { urls: "stun:stun1.l.google.com:19302" }
            ]
        });

        pc.onicecandidate = (event) => {
            if (event.candidate && sessionRef.current) {
                sessionRef.current.send({
                    payload: {
                        type: "WEBRTC_ICE",
                        candidate: event.candidate
                    }
                }, peerId);
            }
        };

        if (sessionConfig.role === Role.VIEWER) {
            pc.ontrack = (event) => {
                if (event.streams && event.streams[0]) {
                    setIncomingStream(event.streams[0]);
                }
            };
        }

        peerConnectionsRef.current.set(peerId, pc);
        return pc;
    };

    const handleLocalFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (files && files.length === 1) {
            const file = files[0];
            const { name } = file;
            const fileObj = URL.createObjectURL(file);
            setLocalVideoInfo({ fileObj, name });

            // If OWNER, stream new tracks to all existing peer connections
            if (sessionConfig.role === Role.OWNER) {
                hostStreamRef.current = null; // Clear cached stream to capture new file
                setTimeout(() => {
                    const stream = getHostStream();
                    if (stream) {
                        const s = stream;
                        peerConnectionsRef.current.forEach((pc, viewerId) => {
                            pc.getSenders().forEach(sender => pc.removeTrack(sender));
                            s.getTracks().forEach(track => pc.addTrack(track, s));
                            pc.createOffer().then(async (offer) => {
                                await pc.setLocalDescription(offer);
                                sessionRef.current?.send({
                                    payload: {
                                        type: "WEBRTC_OFFER",
                                        offer
                                    }
                                }, viewerId);
                            });
                        });
                    }
                }, 1000);
            }
        }
    };
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
                    // Send JOIN message to Host with information on whether we have a local video file
                    await session.send({
                        payload: {
                            type: "JOIN",
                            nickname: sessionConfig.nickname,
                            hasVideo: !!(sessionConfig.videoInfo && sessionConfig.videoInfo.fileObj)
                        }
                    }, sessionConfig.roomCode);

                    addSystemMessage(`Connecting to room ${sessionConfig.roomCode}...`);
                }

                session.onEnvelope = (envelope: Envelope) => {
                    const { type, nickname, paused, position, roomName: rName, participants: parts, msg } = envelope.payload;
                    const senderId = envelope.senderId || "";
                    console.log("[DEBUG][onEnvelope] senderId:", senderId, "type:", type, "payload:", envelope.payload);

                    if (type === "JOIN" && sessionConfig.role === Role.OWNER) {
                        // Register participant
                        participantsSetRef.current.add(senderId);
                        participantsNamesMapRef.current.set(senderId, nickname);
                        // Record whether this viewer has a local video file
                        viewerHasVideoMapRef.current.set(senderId, envelope.payload.hasVideo === undefined ? false : !!envelope.payload.hasVideo);
                        
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

                        // Set up WebRTC peer connection to stream Host's media to new Viewer
                        const pc = getOrCreatePeerConnection(senderId);
                        const stream = getHostStream();
                        if (stream) {
                            stream.getTracks().forEach(track => pc.addTrack(track, stream));
                        }

                        pc.createOffer().then(async (offer) => {
                            await pc.setLocalDescription(offer);
                            session.send({
                                payload: {
                                    type: "WEBRTC_OFFER",
                                    offer
                                }
                            }, senderId);
                        }).catch(err => console.error("Error creating WebRTC offer:", err));
                    } else if (type === "STATE" && sessionConfig.role === Role.VIEWER) {
                        setRoomName(rName);
                        if (parts) setParticipants(parts);

                        // Sync local video only if we have a local file loaded
                        if (localVideoInfo && localVideoInfo.fileObj && videoRef.current) {
                            console.log("[DEBUG][onEnvelope][STATE] programmatic update. paused:", paused, "position:", position);
                            isSyncingRef.current = true;
                            videoRef.current.currentTime = position;
                            if (paused) {
                                console.log("[DEBUG][video.pause()] called (STATE)");
                                videoRef.current.pause();
                            } else {
                                console.log("[DEBUG][video.play()] called (STATE)");
                                videoRef.current.play().catch(() => {});
                            }
                            setTimeout(() => { isSyncingRef.current = false; }, 300);
                        }

                        addSystemMessage(`Joined watch party: "${rName}"`);
                    } else if (type === "SYNC" && sessionConfig.role === Role.VIEWER) {
                        // Only sync if we are playing our own local media file
                        if (!localVideoInfo || !localVideoInfo.fileObj) return;

                        // Sync local video state from Host
                        if (videoRef.current) {
                            console.log("[DEBUG][onEnvelope][SYNC] programmatic update. paused:", paused, "position:", position);
                            isSyncingRef.current = true;
                            videoRef.current.currentTime = position;
                            if (paused) {
                                console.log("[DEBUG][video.pause()] called (SYNC)");
                                videoRef.current.pause();
                            } else {
                                console.log("[DEBUG][video.play()] called (SYNC)");
                                videoRef.current.play().catch(() => {});
                            }
                            setTimeout(() => { isSyncingRef.current = false; }, 300);
                        }
                    } else if (type === "STATE_CHANGE" && sessionConfig.role === Role.OWNER) {
                        // Only allow state changes from viewers who actually have a local video file loaded!
                        // If the viewer is in WebRTC stream mode, discard their playback control requests.
                        const hasVideo = viewerHasVideoMapRef.current.get(senderId);
                        if (!hasVideo) {
                            return;
                        }

                        // Viewer requested play/pause/seek state change
                        if (videoRef.current) {
                            console.log("[DEBUG][onEnvelope][STATE_CHANGE] programmatic update. paused:", paused, "position:", position);
                            isSyncingRef.current = true;
                            videoRef.current.currentTime = position;
                            if (paused) {
                                console.log("[DEBUG][video.pause()] called (STATE_CHANGE)");
                                videoRef.current.pause();
                            } else {
                                console.log("[DEBUG][video.play()] called (STATE_CHANGE)");
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
                    } else if (type === "WEBRTC_OFFER") {
                        const pc = getOrCreatePeerConnection(senderId);
                        pc.setRemoteDescription(new RTCSessionDescription(envelope.payload.offer))
                            .then(() => {
                                pc.createAnswer().then(async (answer) => {
                                    await pc.setLocalDescription(answer);
                                    session.send({
                                        payload: {
                                            type: "WEBRTC_ANSWER",
                                            answer
                                        }
                                    }, senderId);
                                });
                            })
                            .catch(err => console.error("Error setting remote offer:", err));
                    } else if (type === "WEBRTC_ANSWER") {
                        const pc = peerConnectionsRef.current.get(senderId);
                        if (pc) {
                            pc.setRemoteDescription(new RTCSessionDescription(envelope.payload.answer))
                                .catch(err => console.error("Error setting remote answer:", err));
                        }
                    } else if (type === "WEBRTC_ICE") {
                        const pc = peerConnectionsRef.current.get(senderId);
                        if (pc) {
                            pc.addIceCandidate(new RTCIceCandidate(envelope.payload.candidate))
                                .catch(err => console.warn("Error adding ICE candidate:", err));
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
            peerConnectionsRef.current.forEach(pc => pc.close());
            peerConnectionsRef.current.clear();
        };
    }, []);

    // Broadcast local video play/pause/seek events to peers
    const handleVideoEvent = () => {
        if (!videoRef.current || !sessionRef.current) {
            console.log("[DEBUG][handleVideoEvent] early return (no video or session)");
            return;
        }
        console.log("[DEBUG][handleVideoEvent] event fired. isSyncingRef:", isSyncingRef.current, "paused:", videoRef.current.paused, "currentTime:", videoRef.current.currentTime);
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
            // Only send state changes if we are playing our own local media file.
            // If we are in WebRTC streaming mode (localVideoInfo is null), ignore local events.
            if (!localVideoInfo) return;

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
        const isOwner = sessionConfig.role === Role.OWNER;
        const hasLocalVideo = !!(localVideoInfo && localVideoInfo.fileObj);

        // Only bind event listeners if Host (Owner) or Viewer playing their own local file
        if (!isOwner && !hasLocalVideo) {
            return;
        }

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
    }, [roomCode, localVideoInfo]);

    // Attach incoming WebRTC stream to Viewer's video player
    useEffect(() => {
        if (videoRef.current && incomingStream) {
            videoRef.current.srcObject = incomingStream;
        }
    }, [incomingStream, localVideoInfo]);

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
                {localVideoInfo ? (
                    <video ref={videoRef} src={localVideoInfo.fileObj} controls></video>
                ) : incomingStream ? (
                    <video ref={videoRef} autoPlay controls style={{ width: "100%", height: "100%" }}></video>
                ) : (
                    <div className="no-video-placeholder">
                        <span className="placeholder-icon">🎬</span>
                        <p className="placeholder-text">No video file selected. You are currently in chat-only mode.</p>
                        <div className="file-upload-wrapper" style={{ marginTop: "1rem" }}>
                            <input 
                                id="theater-video-select" 
                                type="file" 
                                accept="video/*" 
                                onChange={handleLocalFileChange} 
                                className="hidden-file-input"
                            />
                            <label htmlFor="theater-video-select" className="file-upload-trigger">
                                <span className="upload-icon">🎬</span>
                                <span className="upload-btn-text">Select Local Video</span>
                            </label>
                        </div>
                    </div>
                )}
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
