import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

// A real terminal, embedded in the page. Backed by an actual pseudo-terminal on the
// server (see app/server/terminal.js) over a WebSocket, cwd'd into the given
// project's folder — so you can run `codex` (or anything else) directly, exactly like
// a normal terminal, and Generate-triggered commands land in this same session.
export default function Terminal({ projectId }) {
  const containerRef = useRef(null);

  useEffect(() => {
    const term = new XTerm({
      cursorBlink: true,
      theme: { background: "#0d0e12" },
      fontSize: 13,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/terminal${query}`);

    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    });

    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "data") term.write(msg.data);
      else if (msg.type === "exit") term.write(`\r\n[process exited with code ${msg.exitCode}]\r\n`);
    });

    const dataListener = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "input", data }));
    });

    const handleResize = () => {
      fitAddon.fit();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      dataListener.dispose();
      ws.close();
      term.dispose();
    };
  }, [projectId]);

  return <div ref={containerRef} className="terminal-container" />;
}
