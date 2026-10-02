import { createContext, useCallback, useContext, useEffect, useState } from "react";

// Site Builder's interface language (English / 한국어). Strings are written in English
// in the code and looked up here by that same English text, so a missing translation
// just falls back to English instead of showing a key. `{name}`-style placeholders are
// filled from t()'s second argument. Only the builder's own UI is translated — never
// the user's page content.

const KO = {
  // ----- Landing -----
  "← Studios": "← 스튜디오",
  "Site Builder": "사이트 빌더",
  "No sites yet — click + to start one.": "아직 사이트가 없습니다 — +를 눌러 시작하세요.",
  "Site name": "사이트 이름",
  Create: "만들기",
  "Creating…": "만드는 중…",
  "Delete {name}": "{name} 삭제",
  'Delete "{name}" and everything in it? This can\'t be undone.': '"{name}"과(와) 그 안의 모든 내용을 삭제할까요? 되돌릴 수 없습니다.',
  "Blank page": "빈 페이지",
  "Start from nothing and drag in rows.": "빈 페이지에서 시작해 행을 끌어다 놓으세요.",
  "Mint Compass": "민트 컴퍼스",
  "Collection guide — hero, “where to start” theme cards, a shelf of covers and a closing note.":
    "컬렉션 가이드 — 대표 이미지, ‘어디서 시작할까’ 테마 카드, 표지 책장, 마무리 문구.",
  "Midnight Library": "미드나잇 라이브러리",
  "Author spotlight — navy and gold, an opening quote, featured books and the full shelf.":
    "작가 스포트라이트 — 네이비와 골드, 여는 인용구, 추천 도서와 전체 책장.",
  "Paper Lantern": "종이 등불",
  "Seasonal reading event — dates, three easy steps, editor's picks and a festival shelf.":
    "시즌 독서 이벤트 — 기간, 간단한 3단계 참여 방법, 에디터 추천, 이벤트 책장.",
  "Neon Ranking": "네온 랭킹",
  "Weekly bestseller chart — a ranked top 5 with covers, then the rest of the chart.":
    "주간 베스트셀러 차트 — 표지와 함께 보는 TOP 5, 이어지는 나머지 순위.",
  "Sunday Brunch": "선데이 브런치",
  "Soft short-read curation — a pull quote, cozy picks side by side, pastel tones.":
    "부드러운 짧은 글 큐레이션 — 인용구, 나란히 놓인 추천작, 파스텔 톤.",
  "Front Page": "프론트 페이지",
  "Editorial review — a newspaper front page with a cover story and reviewed books.":
    "에디토리얼 리뷰 — 커버 스토리와 리뷰 도서로 구성한 신문 1면 스타일.",
  "Checking for local agent…": "로컬 에이전트 확인 중…",
  "Loading site…": "사이트 불러오는 중…",

  // ----- Top bar -----
  "← Sites": "← 사이트 목록",
  "↶ Undo": "↶ 실행 취소",
  "↷ Redo": "↷ 다시 실행",
  "Undo (Ctrl+Z)": "실행 취소 (Ctrl+Z)",
  "Redo (Ctrl+Shift+Z)": "다시 실행 (Ctrl+Shift+Z)",
  "🖥 Desktop": "🖥 데스크톱",
  "📱 Phone": "📱 모바일",
  "Saving…": "저장 중…",
  "Not saved": "저장 안 됨",
  Saved: "저장됨",
  "Open folder": "폴더 열기",
  Preview: "미리보기",
  "Export HTML": "HTML 내보내기",
  "Exporting…": "내보내는 중…",
  "Couldn't save: {message}": "저장하지 못했습니다: {message}",
  "Upload failed: {message}": "업로드 실패: {message}",
  "Export failed: {message}": "내보내기 실패: {message}",
  "Click to dismiss": "클릭하여 닫기",

  // ----- Palette -----
  Rows: "행",
  "Drag onto the page, or click to add.": "페이지로 끌어다 놓거나 클릭해서 추가하세요.",
  "{n}-column row ({ratio})": "{n}단 행 ({ratio})",
  Elements: "요소",
  "Drag into a column. Drop image files from your computer straight onto the page too.":
    "열 안으로 끌어다 놓으세요. 컴퓨터의 이미지 파일도 페이지에 바로 놓을 수 있습니다.",
  Heading: "제목",
  Text: "텍스트",
  Label: "라벨",
  Image: "이미지",
  Button: "버튼",
  Quote: "인용구",
  "Book shelf": "책장",
  Spacer: "여백",
  Divider: "구분선",
  "Custom HTML": "사용자 HTML",
  delete: "삭제",
  duplicate: "복제",
  undo: "실행 취소",
  "page settings": "페이지 설정",

  // ----- Canvas -----
  "Drag a row layout or an element here to start.": "행 레이아웃이나 요소를 여기로 끌어다 놓아 시작하세요.",
  "Drop elements here": "요소를 여기에 놓으세요",
  "Image — choose a file on the right, or drop one here": "이미지 — 오른쪽에서 파일을 고르거나 여기에 놓으세요",
  "Book shelf — add covers on the right": "책장 — 오른쪽에서 표지를 추가하세요",
  "⠿ Row": "⠿ 행",
  "Drag to move row": "끌어서 행 이동",
  "Column layout": "열 레이아웃",
  "1 column": "1열",
  "{n} cols · {ratio}": "{n}열 · {ratio}",
  "{n} columns · {ratio}": "{n}열 · {ratio}",
  "Move up": "위로 이동",
  "Move down": "아래로 이동",
  "Duplicate row": "행 복제",
  "Delete row": "행 삭제",
  "Duplicate (Ctrl+D)": "복제 (Ctrl+D)",
  "Delete (Del)": "삭제 (Del)",

  // ----- Preview -----
  "Exactly what Export produces (links and book buttons are live here).":
    "내보내기 결과와 똑같습니다 (여기서는 링크와 도서 버튼이 실제로 동작합니다).",
  Close: "닫기",
  "Site preview": "사이트 미리보기",

  // ----- Inspector: page -----
  "Page settings": "페이지 설정",
  "Click any row or element on the page to edit it.": "페이지의 행이나 요소를 클릭하면 편집할 수 있습니다.",
  "Back to page settings (Esc)": "페이지 설정으로 돌아가기 (Esc)",
  "Row settings": "행 설정",
  "Edit the row this element is in (background, padding, columns)": "이 요소가 들어 있는 행 편집 (배경, 여백, 열)",
  "Page title (browser tab)": "페이지 제목 (브라우저 탭)",
  "Language code": "언어 코드",
  "ko, en, ja…": "ko, en, ja…",
  "Page width (px)": "페이지 너비 (px)",
  Font: "글꼴",
  "System (Korean-friendly)": "시스템 (한글 최적화)",
  Serif: "명조/세리프",
  Rounded: "둥근 글꼴",
  Monospace: "고정폭",
  "Background (outside the page)": "배경 (페이지 바깥)",
  "Page background": "페이지 배경",
  "Text color": "글자 색",

  // ----- Inspector: row -----
  Row: "행",
  Columns: "열",
  "Stack columns on phones": "모바일에서 열을 세로로 쌓기",
  "Vertical alignment": "세로 정렬",
  Top: "위",
  Middle: "가운데",
  Bottom: "아래",
  Stretch: "늘이기",
  Background: "배경",
  "Padding top/bottom": "안쪽 여백 위/아래",
  "Padding sides": "안쪽 여백 좌우",
  "Outer margin top/bottom": "바깥 여백 위/아래",
  "Outer margin sides": "바깥 여백 좌우",
  "Gap between columns": "열 간격",
  "Gap between elements": "요소 간격",
  "Border width": "테두리 두께",
  "Corner radius": "모서리 둥글기",
  "Border style": "테두리 스타일",
  "Border color": "테두리 색",
  Solid: "실선",
  Dashed: "파선",
  Dotted: "점선",
  Double: "이중선",

  // ----- Inspector: elements -----
  "Heading level": "제목 수준",
  "Font size (px)": "글자 크기 (px)",
  Weight: "굵기",
  Regular: "보통",
  Bold: "굵게",
  Extra: "더 굵게",
  Black: "가장 굵게",
  "Line height": "줄 간격",
  Alignment: "정렬",
  Left: "왼쪽",
  Center: "가운데",
  Right: "오른쪽",
  "Bar color": "막대 색",
  "Full width": "전체 너비",
  "Alt text (describes the image)": "대체 텍스트 (이미지 설명)",
  "Width (%)": "너비 (%)",
  "Height (px)": "높이 (px)",
  "Thickness (px)": "두께 (px)",
  Color: "색",
  "HTML (scripts only run in Preview and the export)": "HTML (스크립트는 미리보기와 내보낸 파일에서만 실행됩니다)",
  "Remove image": "이미지 제거",
  "Click or drop an image": "클릭하거나 이미지를 놓으세요",
  "Click to choose an image, or drop one here": "클릭해서 이미지를 고르거나 여기에 놓으세요",
  "Uploading…": "업로드 중…",
  "Use the default": "기본값 사용",
  default: "기본값",

  // ----- Border & box -----
  "Border & box": "테두리 및 상자",
  "Border width (px)": "테두리 두께 (px)",
  "Inner padding (px)": "안쪽 여백 (px)",
  "Box background": "상자 배경",

  // ----- Actions -----
  "When tapped": "탭했을 때",
  Nothing: "동작 없음",
  "Open a web link": "웹 링크 열기",
  "Open a PageBox book": "PageBox 도서 열기",
  "Book code, e.g. CM1789619174392963": "도서 코드, 예: CM1789619174392963",
  "Book codes look like CM followed by digits.": "도서 코드는 CM 뒤에 숫자가 붙는 형식입니다.",

  // ----- Book shelf -----
  "Gap (px)": "간격 (px)",
  "Cover shape": "표지 비율",
  Book: "도서",
  Square: "정사각형",
  Wide: "가로형",
  "Show titles": "제목 표시",
  "Title size (px)": "제목 크기 (px)",
  "＋ Add covers — click or drop several images": "＋ 표지 추가 — 클릭하거나 여러 이미지를 놓으세요",
  Title: "제목",
  "Move earlier": "앞으로 이동",
  "Move later": "뒤로 이동",
  Remove: "제거",
  "Switch to light mode": "라이트 모드로 전환",
  "Switch to dark mode": "다크 모드로 전환",
};

const DICTIONARIES = { en: {}, ko: KO };
const STORAGE_KEY = "siteBuilderLang";

function readStoredLang() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "ko" ? "ko" : "en";
  } catch {
    return "en";
  }
}

export function translate(lang, text, vars) {
  const template = DICTIONARIES[lang]?.[text] ?? text;
  return vars ? template.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : template;
}

const LangContext = createContext({ lang: "en", setLang: () => {}, t: (s, v) => translate("en", s, v) });

export function LangProvider({ children }) {
  const [lang, setLangState] = useState(readStoredLang);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // private mode / blocked storage — the choice just won't persist
    }
  }, [lang]);
  const t = useCallback((text, vars) => translate(lang, text, vars), [lang]);
  return <LangContext.Provider value={{ lang, setLang: setLangState, t }}>{children}</LangContext.Provider>;
}

export const useLang = () => useContext(LangContext);
export const useT = () => useContext(LangContext).t;

// Two-option switch for the top bars: English | 한국어.
export function LangToggle() {
  const { lang, setLang } = useLang();
  return (
    <span className="site-lang-toggle" role="group" aria-label="Language / 언어">
      <button type="button" className={lang === "en" ? "active" : ""} onClick={() => setLang("en")}>
        English
      </button>
      <button type="button" className={lang === "ko" ? "active" : ""} onClick={() => setLang("ko")}>
        한국어
      </button>
    </span>
  );
}
