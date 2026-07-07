import { useState } from "react";
import RadioCardGroup, { RadioCardOption } from "./RadioCardGroup";
import { Role } from "../model/Role";

const rolesOptions = [
    {value: Role.OWNER, content: 'Create a new session'},
    {value: Role.VIEWER, content: 'Join'},
];

export default function Login({setSessionConfig}: any) {
    const [formData, setFormData] = useState(function getInitialFormData() {
        const params = new URLSearchParams(window.location.search);
        const codeFromUrl = params.get('code') || '';
        const roleFromUrl = codeFromUrl ? Role.VIEWER : '';

        return {
            /**
             * If the current user is OWNER, its value is read-only and is automatically set to `remoteKey`.
             * Can be manually set by VIEWER.
             * Though try to automatically set from the URL if the param exists.
             */
            roomCode: codeFromUrl,
    
            // See rolesOptions
            // if roomCode was found in the URL, assume we are viewer; else, we are owner.
            role: roleFromUrl,
    
            /**
             * validated by the Owner, can't be changed (for now).
             */ 
            nickname: '',
            nicknameIsValid: null,
            // Waiting for response from the Owner.
            nicknameIsValidating: false,
    
            /**
             * Currently we are using videoInfo.name as default value (and placeholder) for room name.
             * 
             * - `name` contains extension. It's like calling Node's `Path.basename(videoFilePath)`.
             *   e.g. `CHARADE_1953.ogv`.
             */
            videoInfo: null as null | {
                fileObj: string,
                name: string,
            },
            // TODO.
            subtitleFile: null,
    
            // If it's empty and we role is owner, it is set to `videoInfo.name` when starting.
            roomName: '',
        }
    });

    // WIP
    const info = formData;
    const canStart = !!(
        info.role &&
        info.nickname &&
        (info.role === Role.OWNER ? !!formData.videoInfo : true) &&
        (info.role === Role.OWNER || info.roomCode)
    );

    function handleSubmit(e: any) {
        e.preventDefault();

        console.info(formData);
        setSessionConfig({
            role: formData.role,
            nickname: formData.nickname,
            roomCode: formData.roomCode,
            roomName: formData.roomName || formData.videoInfo?.name || "Some watch party",
            videoInfo: formData.videoInfo
        });
    }

    function handleChange(e: any) {
        const { name, value } = e.target;
        setFormData((prevState) => ({ ...prevState, [name]: value }));
    }

    function handleRoleSelect(x: RadioCardOption) {
        setFormData((prevState) => ({...prevState, role: x.value}));
    }

    function handleFileChange(e: any) {
        const files: FileList = e.target.files;
        if (files.length === 1) {
            const file = files[0];
            const { name } = file;
            const fileObj = URL.createObjectURL(file);
            const videoInfo = { fileObj, name };
            setFormData(prev => ({...prev, videoInfo}));
        } else if (files.length === 0) {
            // Maybe a file was selected then unselected...
            // Imagine this scenario: Clicks select file > Selects file > Clicks select file > Cancels.
            // Maybe we should not create the file obj until we actually **start**.
            // The obj will be revoked once the page is closed anyways.
            if (formData.videoInfo?.fileObj) {
                URL.revokeObjectURL(formData.videoInfo.fileObj);
                //formData.videoInfo.fileObj = null;
            }
            setFormData(prev => ({...prev, videoInfo: null}));
        }
    }

    return (
        <form onSubmit={handleSubmit} className="bento-container">
            {/* Card 1: Brand / Title */}
            <div className="bento-card bento-card--brand">
                <div className="brand-logo">🍿</div>
                <h1 className="brand-title">SyncPlay</h1>
                <p className="brand-subtitle">Watch local videos in sync with friends.</p>
            </div>

            {/* Card 2: Role Selector */}
            <div className="bento-card bento-card--role">
                <span className="bento-label">Your Role</span>
                <RadioCardGroup
                    name="role"
                    radios={rolesOptions}
                    onSelected={handleRoleSelect}
                    selectedValue={formData.role}
                />
            </div>

            {/* Card 3: Nickname */}
            <div className="bento-card bento-card--nickname">
                <label htmlFor="nickname" className="bento-label">Nickname</label>
                <div className="nickname-input-wrapper">
                    <input 
                        id="nickname"
                        minLength={1}
                        name="nickname" 
                        value={formData.nickname} 
                        onChange={handleChange}
                        className="bento-input"
                        placeholder="Enter your nickname"
                    />
                    {formData.nicknameIsValidating && (
                        <span className="inline-loader">Validating...</span>
                    )}
                </div>
            </div>

            {/* Card 4: Video Selector */}
            <div className="bento-card bento-card--video">
                <label className="bento-label">Select Video</label>
                <div className="file-upload-wrapper">
                    <input 
                        id="videofile" 
                        type="file" 
                        accept="video/*" 
                        onChange={handleFileChange} 
                        className="hidden-file-input"
                    />
                    <label htmlFor="videofile" className="file-upload-trigger">
                        <span className="upload-icon">🎬</span>
                        <span className="file-name-display">
                            {formData.videoInfo?.name || "No file chosen"}
                        </span>
                        <span className="upload-btn-text">Browse Files</span>
                    </label>
                    <button 
                        type="button" 
                        id="load-demo-video-btn"
                        onClick={() => setFormData(prev => ({
                            ...prev, 
                            videoInfo: { 
                                name: "demo.mp4", 
                                fileObj: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4" 
                            }
                        }))}
                        className="demo-video-btn"
                        style={{ marginTop: '0.5rem', width: '100%', padding: '0.5rem', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff', cursor: 'pointer' }}
                    >
                        Demo Video (for testing)
                    </button>
                </div>
            </div>

            {/* Card 5: Room Settings */}
            <div className={`bento-card bento-card--room-settings ${!formData.role ? 'bento-card--disabled' : ''}`}>
                {!formData.role ? (
                    <>
                        <span className="bento-label">Connection</span>
                        <input 
                            className="bento-input bento-input--readonly" 
                            placeholder="Select role first" 
                            disabled 
                        />
                    </>
                ) : formData.role === Role.OWNER ? (
                    <>
                        <label htmlFor="roomName" className="bento-label">Room Name</label>
                        <input 
                            id="roomName"
                            placeholder={formData.videoInfo?.name || "Some watch party"}
                            name="roomName" 
                            value={formData.roomName} 
                            onChange={handleChange}
                            className="bento-input"
                        />
                    </>
                ) : (
                    <>
                        <label htmlFor="roomCode" className="bento-label">Room Code</label>
                        <input 
                            id="roomCode"
                            name="roomCode" 
                            value={formData.roomCode} 
                            onChange={handleChange}
                            className="bento-input"
                            placeholder="Enter Room Code"
                        />
                    </>
                )}
            </div>

            {/* Card 6: Start Button */}
            <div className="bento-card bento-card--action">
                <button aria-label="start" disabled={!canStart} className="start-btn">
                    <span>Start Session</span>
                    <span className="btn-arrow">→</span>
                </button>
            </div>
        </form>
    );

}
