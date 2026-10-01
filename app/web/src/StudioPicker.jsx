import { useTheme, ThemeToggle } from "./Shared";
import "./studio-picker.css";

// The very first screen: choose which studio to work in. Each studio is a fully
// separate project list/workflow/backend (see main.jsx) — this picker just remembers
// the last choice (see main.jsx's localStorage-backed `studio` state) so returning
// visitors land straight back in the same studio next time, with a "← Studios" link
// inside it to come back here.
export default function StudioPicker({ onPick }) {
  const [theme, onToggleTheme] = useTheme();
  return (
    <div className="landing studio-picker">
      <div className="landing-header">
        <h1>Ibraheem Studio</h1>
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      </div>
      <div className="studio-grid">
        <button className="studio-card" onClick={() => onPick("manga")}>
          <span className="studio-card-icon">📖</span>
          <span className="studio-card-name">Manga Studio</span>
          <span className="studio-card-desc">Draw AI-illustrated manga/comic pages, panel by panel.</span>
        </button>
        <button className="studio-card" onClick={() => onPick("html")}>
          <span className="studio-card-icon">📰</span>
          <span className="studio-card-name">HTML Shorts Maker</span>
          <span className="studio-card-desc">
            Curate an illustrated, condensed "10-minute read" of a book as one self-contained HTML file.
          </span>
        </button>
        <button className="studio-card" onClick={() => onPick("site")}>
          <span className="studio-card-icon">🧱</span>
          <span className="studio-card-name">Site Builder</span>
          <span className="studio-card-desc">
            Drag elements into rows to design a web page, then export it as one HTML file.
          </span>
        </button>
      </div>
    </div>
  );
}
