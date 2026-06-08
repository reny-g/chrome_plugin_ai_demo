# JD Resume Optimizer Chrome Extension Design

## Background

The current project is a lightweight Chrome Manifest V3 extension. It can open a side panel, extract readable text from the active tab, and call an OpenAI-compatible API to generate a Chinese web page summary.

This design extends the extension into a dual-mode tool:

- Web summary mode: keep the existing page summary workflow.
- Resume optimization mode: upload one Markdown resume, read the active page as a possible job description, and generate two optimized Markdown resume versions.

The MVP should remain incremental. It should reuse the current no-build-file structure and avoid introducing a backend, account system, build pipeline, or site-specific scraping rules.

## Goals

1. Preserve the existing page summary feature.
2. Add one local Markdown resume profile stored in `chrome.storage.local`.
3. Let the user upload, replace, view, and clear the current resume.
4. Use the active web page as JD input, even if the page is not from a known recruitment site.
5. Ask AI to analyze the JD and generate two complete Markdown resumes:
   - Aspirational resume: as close as possible to the JD, but marks missing or unsupported content with explicit `[待补充：...]` placeholders.
   - Grounded resume: improves only the content supported by the original resume, mainly through rewriting, emphasis, ordering, and angle changes.
6. Keep the optimized resumes close to the original resume's Markdown structure, section order, heading style, list granularity, and writing style unless a small adjustment is necessary.
7. Provide copy and download actions for both generated resume versions.
8. Show JD analysis, gap suggestions, and warnings clearly.

## Non-Goals

1. No multi-resume management in the MVP.
2. No cloud storage, login, account sync, or version history.
3. No Boss Zhipin, Lagou, Liepin, or other site-specific extraction rules in the MVP.
4. No backend proxy for AI calls in this phase.
5. No PDF/DOCX resume import or export.
6. No automatic job application or browser form filling.

## Recommended Approach

Use the current extension structure and add the feature incrementally:

```text
chrome_plugin_ai_demo/
|-- manifest.json
|-- background.js
|-- content.js
|-- sidepanel.html
|-- sidepanel.css
|-- sidepanel.js
|-- options.html
|-- options.js
|-- icons/
`-- docs/
```

Responsibilities should stay clear:

- `content.js`: extract active page title, URL, and readable text only.
- `background.js`: route messages, read settings, read the saved resume, extract the active page, build prompts, call the AI provider, and return normalized results.
- `sidepanel.js`: manage UI state, resume upload/view/clear actions, mode switching, rendering, copy actions, and download actions.
- `options.js`: keep managing provider settings.
- `chrome.storage.local`: store provider settings and one current resume.

## Phased Scope

### Phase 1: Local Resume Management And Mode Switching

Phase 1 adds the resume mode shell without AI resume generation.

Required behavior:

1. Add a mode switch in the side panel: `网页摘要` and `简历优化`.
2. Keep the existing summary workflow available in `网页摘要`.
3. Add a `简历优化` panel with current resume status.
4. Allow uploading a `.md` file.
5. Reject empty files and non-Markdown files.
6. Save the resume in `chrome.storage.local`.
7. Store at least:
   - `markdown`
   - `fileName`
   - `updatedAt`
   - `length`
8. Show saved resume metadata after refresh or side panel reopen.
9. Allow viewing the saved resume in the side panel.
10. Allow replacing and clearing the saved resume.
11. Disable or block generation actions until a resume exists.

Phase 1 acceptance:

1. Existing summary mode still works.
2. A Markdown resume can be uploaded and persists locally.
3. The resume can be viewed, replaced, and cleared.
4. Missing resume state is clear and actionable.

### Phase 2: JD Resume Optimization Generation

Phase 2 connects resume mode to active page extraction and AI generation.

Required behavior:

1. Add a new message type such as `OPTIMIZE_RESUME_FOR_ACTIVE_TAB`.
2. `background.js` handles the message by:
   - Extracting the active page with the existing `extractActiveTab()`.
   - Reading the saved resume from `chrome.storage.local`.
   - Loading provider settings.
   - Calling the OpenAI-compatible chat completion API.
3. The prompt must ask the model to return a JSON string with these fields:
   - `jdAnalysis`
   - `aspirationalResumeMarkdown`
   - `groundedResumeMarkdown`
   - `gapSuggestions`
   - `warnings`
4. The result UI renders:
   - JD analysis
   - Aspirational resume
   - Grounded resume
   - Gap suggestions and warnings
5. Each generated resume has:
   - Copy button
   - Download as `.md` button
6. The analysis and suggestions can optionally be downloaded as a Markdown report.
7. If the page does not look like a JD, generation is still allowed, but the warning must be visible.
8. If JSON parsing fails, show the raw AI output and a clear format error message.
9. If page content or resume content is truncated, include a warning.

Phase 2 acceptance:

1. A JD-like page can produce two complete Markdown resumes.
2. The aspirational resume uses `[待补充：...]` for content not supported by the original resume.
3. The grounded resume does not invent companies, projects, dates, skills, responsibilities, or metrics absent from the original resume.
4. Both generated resumes can be copied and downloaded.
5. Non-JD pages show a warning but do not hard-block generation.
6. JSON parsing failure does not leave the result area blank.

## AI Output Contract

The AI response should be a JSON string. The extension should parse it before rendering.

Expected shape:

```json
{
  "jdAnalysis": {
    "isLikelyJobDescription": true,
    "confidence": "high",
    "jobTitle": "string",
    "coreResponsibilities": ["string"],
    "requiredSkills": ["string"],
    "preferredSkills": ["string"],
    "softSkills": ["string"],
    "keywords": ["string"]
  },
  "aspirationalResumeMarkdown": "string",
  "groundedResumeMarkdown": "string",
  "gapSuggestions": [
    {
      "area": "string",
      "reason": "string",
      "suggestion": "string"
    }
  ],
  "warnings": ["string"]
}
```

The parser should tolerate minor shape differences where practical, but missing resume fields are fatal for normal rendering and should fall back to raw output display.

## Prompt Rules

The resume optimization prompt must include these rules:

1. Output only valid JSON.
2. Use Chinese unless the source resume is clearly written in another language.
3. Generate two complete Markdown resumes.
4. Preserve the original resume structure, heading style, list granularity, and tone as much as possible.
5. Do not convert the resume into a completely different template unless the original structure is unusable.
6. In the aspirational version, missing skills, projects, achievements, or experience must be marked as `[待补充：具体内容]`.
7. In the grounded version, do not add facts not found in the original resume.
8. Rewriting can improve clarity, relevance, keyword coverage, and framing.
9. If the JD is weak, missing, or not clearly a JD, state that in `warnings`.
10. If source content is truncated, state that in `warnings`.

## Data Flow

Summary mode:

```text
User clicks summarize
-> sidepanel sends SUMMARIZE_ACTIVE_TAB
-> background extracts active tab
-> background calls AI
-> sidepanel renders summary
```

Resume optimization mode:

```text
User uploads Markdown resume
-> sidepanel stores resume in chrome.storage.local
-> user opens a JD or any page
-> user clicks generate resume optimization
-> sidepanel sends OPTIMIZE_RESUME_FOR_ACTIVE_TAB
-> background extracts active tab
-> background reads saved resume and provider settings
-> background calls AI with JD text, resume text, and output rules
-> background parses or returns raw output state
-> sidepanel renders analysis, two resumes, suggestions, warnings, copy actions, and download actions
```

## UI Design

The side panel should keep a compact operational layout.

Top controls:

- Mode switch: `网页摘要` / `简历优化`
- Provider select
- Settings link

Summary mode:

- Keep current summary button and result layout.
- Keep source evidence and copy actions.

Resume optimization mode:

- Current resume section:
  - File name
  - Updated time
  - Character count
  - Upload/replace button
  - View button
  - Clear button
- Generation section:
  - Generate button
  - Current page title and URL after extraction or generation
  - Status and error messages
- Result section:
  - JD analysis
  - Aspirational resume
  - Grounded resume
  - Gap suggestions and warnings

Result actions:

- Copy aspirational resume
- Download aspirational resume
- Copy grounded resume
- Download grounded resume
- Download analysis and suggestions report

Download filenames should be deterministic and readable, for example:

- `resume-aspirational-2026-06-08.md`
- `resume-grounded-2026-06-08.md`
- `resume-analysis-2026-06-08.md`

If the original file name is available, it can be used as the base name after sanitization.

## Error Handling

The extension should handle these states:

1. No saved resume: show a prompt to upload a Markdown resume.
2. Non-Markdown upload: reject with a clear message.
3. Empty upload: reject with a clear message.
4. Unsupported active page: reuse current active-tab extraction error handling.
5. Empty extracted page content: reuse current extraction failure handling.
6. Missing API key: tell the user to configure provider settings.
7. AI request failure: show the provider status and a short response excerpt where available.
8. Invalid AI JSON: show raw AI output and format error.
9. Missing required AI fields: show raw AI output and explain which fields were missing.
10. Truncated content: show a warning in the result area.

## Privacy And Safety

The resume is stored locally in `chrome.storage.local`. The extension does not sync or upload it except when the user triggers AI generation.

When resume optimization is triggered, the extension sends the saved resume and extracted page content to the configured AI provider. The UI or documentation should make this clear before or near the generate action.

The extension should not inject API keys into the active page. API keys remain in extension storage and are used only by extension scripts.

The AI must not be asked to fabricate experience. The aspirational version may use explicit placeholders for missing content. The grounded version must stay faithful to the original resume.

## Verification Plan

Manual verification is enough for this MVP because the current extension has no build system or test harness.

Phase 1 checks:

1. Load the unpacked extension in Chrome.
2. Open the side panel and confirm summary mode still appears.
3. Switch to resume mode.
4. Upload a valid `.md` resume and confirm metadata appears.
5. Close and reopen the side panel and confirm metadata persists.
6. View the resume content.
7. Replace the resume and confirm metadata updates.
8. Clear the resume and confirm generation is blocked.
9. Try uploading a non-Markdown file and confirm it is rejected.
10. Try uploading an empty Markdown file and confirm it is rejected.

Phase 2 checks:

1. Configure a working OpenAI-compatible provider.
2. Upload a Markdown resume.
3. Open a JD-like page and generate resume optimization.
4. Confirm JD analysis, two complete resumes, suggestions, and warnings render.
5. Confirm the aspirational resume uses `[待补充：...]` for unsupported gaps.
6. Confirm the grounded resume does not invent unsupported facts.
7. Copy both generated resumes.
8. Download both generated resumes as `.md`.
9. Open a non-JD page, generate, and confirm a visible warning appears.
10. Force or simulate invalid JSON and confirm raw output fallback appears.

## Future Work

1. Multi-resume management.
2. Site-specific JD extractors for common recruitment sites.
3. Backend proxy for API key protection.
4. PDF/DOCX export.
5. Automatic diff view between original and optimized resumes.
6. Unit tests for prompt construction, JSON parsing, and Markdown download helpers after pure logic is extracted.
