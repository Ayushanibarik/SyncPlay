import { AbstractSession } from ".";
import WebSocketSession from "./WebSocketSession.ts";

export default class SessionManager {
    static defaultImpl = 'WEBSOCKET';

    static create({name}: {name: string}): AbstractSession {
        let instance;

        switch(SessionManager.defaultImpl) {
            case 'WEBSOCKET':
                instance = new WebSocketSession();
                break;
            default:
                throw new Error(`Unknown session type '${SessionManager.defaultImpl}'`);
        }

        instance.name = name;

        return instance;
    }
}
