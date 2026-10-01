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

    // Hardcoded to localhost, not derived from window.location — the frontend may be
    // served from somewhere else entirely, but the terminal bridge only ever runs on
    // the browser's own machine (see api.js for the same reasoning on BASE).
    const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
    let ws = null;
    let reconnectTimer = null;
    let unmounted = false;
    let everConnected = false;

    // The backend restarting (which happens whenever its own code changes) always
    // drops this socket — without reconnecting, the terminal just sits there silently
    // frozen forever, making a Generate/edit request look like it's doing nothing even
    // though it's actually running fine server-side. Announce the gap directly in the
    // terminal output itself (right where you're already looking) rather than failing
    // silently, and heal it automatically a moment later.
    const connect = () => {
      ws = new WebSocket(`ws://localhost:8787/ws/terminal${query}`);

      ws.addEventListener("open", () => {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
        if (everConnected) term.write("\r\n[reconnected]\r\n");
        everConnected = true;
      });

      ws.addEventListener("message", (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === "data") term.write(msg.data);
        else if (msg.type === "exit") term.write(`\r\n[process exited with code ${msg.exitCode}]\r\n`);
      });

      ws.addEventListener("close", () => {
        if (unmounted) return;
        if (everConnected) term.write("\r\n[disconnected — reconnecting…]\r\n");
        reconnectTimer = setTimeout(connect, 1500);
      });
    };
    connect();

    const dataListener = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "input", data }));
    });

    // Watches the container element itself (not just window resize) so dragging or
    // resizing the floating terminal window — which doesn't change the browser
    // window's size — still re-fits xterm to the new dimensions.
    const handleResize = () => {
      fitAddon.fit();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    };
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(containerRef.current);

    return () => {
      unmounted = true;
      clearTimeout(reconnectTimer);
      resizeObserver.disconnect();
      dataListener.dispose();
      ws.close();
      term.dispose();
    };
  }, [projectId]);

  return <div ref={containerRef} className="terminal-container" />;
}
