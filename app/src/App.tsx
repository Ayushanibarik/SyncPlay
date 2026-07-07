import { useState } from "react";
import Login from "./components/Login";
import Theater from "./components/Theater";

function App() {
  const [sessionConfig, setSessionConfig] = useState<any>(null);

  return (
    <>
      {sessionConfig ? (
        <Theater sessionConfig={sessionConfig} />
      ) : (
        <Login setSessionConfig={setSessionConfig} />
      )}
    </>
  );
}

export default App
