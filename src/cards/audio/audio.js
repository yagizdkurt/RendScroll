/* Audio card renderer.
   A small sound-effect / music player dropped into a scene. Authored as
   "### Audio: Optional Caption" with a "File:" line naming an mp3 in the
   audio/ folder. Renders the native HTML5 <audio controls> widget — a play
   button, a seek line, and a current/total time readout — kept compact via CSS.

   It reuses the shared Side: column directive (cardImage.js) but resolves its
   media source itself (audioSrcUrl): a bare name -> /audio/<name>.mp3. The
   launcher serves the repo root, so /audio/* is already reachable. It never
   fetches files or touches the sidebar.

   The card renders in the left column by default; a "Side: R" line moves it to
   the right column. */

// A whole line that is just "File: name". The value capture may be empty.
const AUDIO_FILE_LINE = /^file\s*:\s*(.*)$/i;

/* Resolve a "File: name" value into a usable audio url. A bare name with no
   extension defaults to ".mp3", and a name without a path is looked up under
   audio/. So "tavern", "tavern.mp3" and "audio/tavern.mp3" all work, and
   absolute urls / rooted paths are left untouched. Mirrors cardBgUrl(). */
function audioSrcUrl(raw) {
  let file = raw.trim();
  if (!/\.[a-z0-9]+$/i.test(file)) file += ".mp3";
  if (/^[a-z]+:\/\//i.test(file) || file.startsWith("/")) return file;
  return /[\/\\]/.test(file) ? "/" + file.replace(/\\/g, "/").replace(/^\/+/, "") : "/audio/" + file;
}

/* Text phase (runs before marked): inside an Audio section, isolate the
   directive lines into their own paragraphs so they are not glued into a
   neighbouring list/blockquote and can be lifted out by the builder. */
function normalizeAudioMarkdown(text) {
  return normalizeSectionDirectives(text, {
    startsSection: (line) => /^###\s+audio\s*:/i.test(line),
    endsSection: (line) => /^#{1,3} /.test(line),
    shouldIsolate: (line) => (
      /^file\s*:/i.test(line.trim()) ||
      /^side\s*:/i.test(line.trim())
    ),
  });
}

// Build one Audio card from its heading + body nodes. Returns the card element.
function buildAudioCard(head, nodes) {
  const card = document.createElement("div");
  card.className = "audio-card";

  // Optional caption after the colon ("### Audio: Tavern" -> "Tavern").
  const caption = head.textContent.trim().replace(/^\s*audio\s*:\s*/i, "").trim();

  let fileRaw = "";
  nodes.forEach((n) => {
    const file = n.tagName === "P" && n.textContent.trim().match(AUDIO_FILE_LINE);
    if (file) {
      if (file[1].trim()) fileRaw = file[1].trim();
      return;
    }
    // "Side: R" moves the card to the right column; the line itself is dropped.
    const side = n.tagName === "P" && n.textContent.trim().match(CARD_SIDE_LINE);
    if (side) {
      if (cardSideIsRight(side[1])) card.classList.add("card-right");
      return;
    }
    card.appendChild(n.cloneNode(true));
  });

  // The player is the whole point of the card; render the native compact widget.
  if (fileRaw) {
    const audio = document.createElement("audio");
    audio.setAttribute("controls", "");
    audio.setAttribute("preload", "metadata");
    audio.src = audioSrcUrl(fileRaw);
    card.insertBefore(audio, card.firstChild);
    if (caption) {
      const cap = document.createElement("div");
      cap.className = "audio-caption";
      cap.textContent = caption;
      card.appendChild(cap);
    }
  } else if (caption) {
    // No file given: keep the caption visible as a title so the card isn't empty.
    const cap = document.createElement("div");
    cap.className = "audio-caption";
    cap.textContent = caption;
    card.insertBefore(cap, card.firstChild);
  }

  return card;
}

/* Self-register with the runtime card registry (cards/shared/cardRegistry.js). */
if (typeof RendScrollCards !== "undefined") {
  RendScrollCards.register("audio", { build: buildAudioCard, normalize: normalizeAudioMarkdown });
}
