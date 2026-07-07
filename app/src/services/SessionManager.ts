import { AbstractSession } from ".";
import PeerSession from "./PeerSession.ts";

export default class SessionManager {
    static defaultImpl = 'PEERJS';

    static create({name}: {name: string}): AbstractSession {
        let instance;

        switch(SessionManager.defaultImpl) {
            case 'PEERJS':
                instance = new PeerSession();
                break;
            default:
                throw new Error(`Unknown session type '${SessionManager.defaultImpl}'`);
        }

        instance.name = name;

        return instance;
    }
}
