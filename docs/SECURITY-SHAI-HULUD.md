# Shai-Hulud — supply-chain worm reference & scan runbook

> **למה הקובץ הזה קיים:** ב-2026-06-02 חקרנו את תולעת ה-supply-chain "Shai-Hulud"
> וסרקנו את הריפו. הריפו יצא **נקי**. הקובץ הזה מרכז את כל מסקנות המחקר ואת פקודות
> הסריקה כך ש**לא נצטרך לחקור שוב** — מריצים את הסקשן "Scan runbook" אחרי כל
> `npm install` חשוד או כשמדווח גל הדבקה חדש.
>
> משלים את הכלל הקבוע שלנו: **לעולם לא לצרוך גרסת npm בת פחות מ-7 ימים** (ראו
> `package.json` → `overrides` של `@tiptap/*` כדוגמה חיה — ננעלו ל-3.23.6 כי
> 3.24.0 הייתה בת 4 ימים בלבד).

---

## מה זה Shai-Hulud (בעברית)

תולעת שמדביקה חבילות npm פופולריות ומתפשטת לבד. שלושה גלים ידועים:

- **מקורי** — ספט' 2025.
- **Shai-Hulud 2.0 "The Second Coming"** — ~21–24 בנוב' 2025. ~600–800 חבילות npm /
  1,092 גרסאות, 25k+ ריפוז ב-GitHub. נפגעו מתחזקים ב-Zapier, PostHog, Postman, ENS,
  ובחבילות AsyncAPI.
- **Mini Shai-Hulud / חיקויי TeamPCP** — 2026. TanStack, @antv (300+ חבילות),
  SAP CAP (`@sap/cds*`), Red Hat ("Miasma"). 

**מה התולעת עושה:**

1. מריצה את ה-payload ב-**`preinstall`** (לא רק `postinstall`) — כך היא רצה גם
   בסביבות CI/CD, לא רק על מחשב מפתח.
2. **מתעללת ב-Claude Code / VS Code:** שותלת hook מסוג **`SessionStart`** בקובץ
   `.claude/settings.json` שמריץ `node .claude/setup.mjs` **בשקט בכל פתיחת
   פרויקט** — בלי התראה, בלי אישור, עם הרשאות סוכן מלאות. המקבילה ב-VS Code היא
   task עם `"runOn": "folderOpen"` בקובץ `.vscode/tasks.json`. היא סורקת את
   הדיסק ומזריקה את אותו hook לכל קונפיג Claude/VS Code שהיא מוצאת — כולל
   הגלובלי `~/.claude/settings.json`.
3. **גונבת סודות** עם TruffleHog (סורקת 80+ משתני סביבה ו-130+ נתיבי קבצים):
   טוקני GitHub ו-npm, מפתחות AWS/GCP/Azure.
4. **מתפשטת**: דוחפת קוד זדוני לכל הריפוז שיש להם גישה, מפרסמת גרסאות npm
   זדוניות שנראות כמו עדכוני תלויות רגילים, ויוצרת ריפוז ציבוריים לחילוץ מידע.

### ⚠️ ה-deadman switch — קריטי לדעת לפני כל תגובה

> אם התולעת **לא** מצליחה להשיג טוקן GitHub תקף **וגם** לא מוצאת אישורי npm
> תקפים — היא מנסה **למחוק את כל הקבצים בתיקיית הבית** (`shred` על קבצים מוסתרים).

המשמעות: **תגובת ההגנה האינסטינקטיבית — ביטול הטוקן הגנוב — היא בדיוק מה שמפעיל
את ההרס.** לכן:

- **אל** תריצו `npm install` / `npm ci`, ואל תפתחו את הריפו ב-Claude Code / VS Code,
  על מכונה שכבר נוקתה מאישורי GitHub/npm — זה בדיוק תנאי ה-"אין טוקן" שמזיין את המחיקה.
- בודקים **סטטית בלבד** (הפקודות למטה לא מריצות כלום). אם חייבים להריץ משהו —
  מנתקים רשת קודם.
- אם מתגלה הדבקה: מסובבים את **כל** הטוקנים (GitHub/npm/cloud) **ממכונה נקייה
  אחרת**, ורק אחר כך מנקים את הנגוע.

---

## Indicators of Compromise (IOCs)

### 1. קבצי payload שהתולעת שותלת
```
setup_bun.js
set_bun.js
bun_environment.js
cloud.json
contents.json
environment.json
.claude/setup.mjs          ← (לא לבלבל עם bin/commands/setup.mjs שלנו, שהוא לגיטימי)
.vscode/setup.mjs
.claude/router_runtime.js  ← העתק-עצמי ~2.3MB
FilePII_*.js               ← גונב אישורים (וריאנט Mini)
trufflehog                 ← בינארי שסורק סודות
Runner.Listener            ← GitHub Actions runner; רשום בשם "SHA1HULUD"
.github/workflows/shai-hulud-workflow.yml  ← workflow שלא אתם כתבתם
```

### 2. package.json — סקריפטים זדוניים
- `preinstall` / `postinstall` שמפנה ל-`bun_environment.js` / `setup_bun.js`,
  למשל `"preinstall": "node setup_bun.js"`.
- וריאנט Mini מסתיר ריצה עם `&& exit 1` בסוף (כדי ש-npm יתייחס לתלות כ"נכשלה" ויסתיר אותה).
- כל pipe מסוג `curl … | bash` / `curl … | sh`.
- הורדת runtime של Bun (`bun.sh`) בתוך סקריפט התקנה.

### 3. Claude Code / VS Code (הספציפי לנו)
- `.claude/settings.json` עם hook **`SessionStart`** שמריץ `node .claude/setup.mjs`
  (או `.vscode/setup.mjs`). בודקים **גם** את הפרויקט **וגם** את הגלובלי
  `~/.claude/settings.json` ו-`~/.claude.json`.
- `.vscode/tasks.json` עם task ש-`"runOn": "folderOpen"`.

> **הערה לגבי הריפו שלנו:** ה-`SessionStart` hook הלגיטימי שלנו ב-
> `.claude/settings.local.json` מריץ רק `cat docs/local/REMINDERS.md ROADMAP.md`.
> זה תקין. ה-`setup.mjs` שלנו נמצא ב-`bin/commands/setup.mjs` (ה-CLI שלנו,
> git-tracked) — **לא** ב-`.claude/`.

### 4. רשת / GitHub / חילוץ מידע
- ריפוז ציבוריים שהתולעת יוצרת עם תיאור **`Sha1-Hulud: The Second Coming.`** ושמות
  אקראיים בתבנית `[0-9a-z]{18}`. נושאי branch/repo: "Shai-Hulud", "Shai-Hulud Migration".
- persona מזויף של commit author: **"Linus Torvalds"**.
- self-hosted GitHub Actions runner בשם **`SHA1HULUD`**.
- חילוץ היסטורי גם דרך endpoints של **`webhook.site`**.

### 5. חבילות שנפגעו (לפי גל)
- **נוב' 2025 (2.0):** `@asyncapi/*`; מתחזקים ב-Zapier, PostHog, Postman, ENS. ~796 חבילות / 1,092 גרסאות.
- **2026 Mini/TeamPCP:** **TanStack**, **@antv** (300+), **SAP CAP** (`@sap/cds*`), **Red Hat** ("Miasma", ~170 npm + 2 PyPI).
- כלל אצבע: כל גרסה ב-lockfile שלכם עם תאריך פרסום **מסוף נוב' 2025 והלאה** עבור
  ה-scopes האלה — חשודה. רשימה סמכותית מתעדכנת: DataDog `shai-hulud-2.0.csv` +
  `consolidated_iocs.csv` (קישור למטה).

### 6. Hashes (SHA-256) של דגימות נפוצות
> וריאנטים חדשים מופיעים תכופות — **זיהוי לפי שם/סקריפט/hook (#1–4) אמין יותר
> מ-hash**. אבל אם מצאתם קובץ חשוד, השוו:
```
setup_bun.js       : a3894003ad1d293ba96d77881ccd2071446dc3f65f434669b49b3da92421901a
bun_environment.js : 62ee164b9b306250c1172583f138c9614139264f889fa99614903c12755468d0
                     cbb9bc5a8496243e02f3cc080efbe3e4a1430ba0671f2e43a202bf45b05479cd
                     f099c5d9ec417d4445a0328ac0ada9cde79fc37410914103ae9c609cbc0ee068
```

---

## Scan runbook (read-only — לא מריץ כלום)

מריצים מ-root של הריפו. כל hit ב-#1–4 → **עצרו**, התייחסו למכונה כנגועה, וסובבו
טוקנים ממכונה נקייה לפני כל ניקוי (ראו אזהרת ה-deadman switch למעלה).

```bash
# 1. קבצי payload שהושתלו
find . \( -name 'setup_bun.js' -o -name 'set_bun.js' -o -name 'bun_environment.js' \
  -o -name 'cloud.json' -o -name 'contents.json' -o -name 'environment.json' \
  -o -name 'router_runtime.js' -o -name 'FilePII_*.js' -o -name 'trufflehog' \) 2>/dev/null
#   (התעלמו מ-bin/commands/setup.mjs ומ-node_modules/motion-dom/.../setup.mjs — לגיטימיים)

# 2. סקריפטי lifecycle זדוניים בכל package.json (כולל תלויות)
grep -rEn '"(pre|post)?install"[[:space:]]*:[[:space:]]*".*(bun_environment|setup_bun|set_bun|curl.*\|[[:space:]]*(ba)?sh|&& exit 1)' \
  --include=package.json . 2>/dev/null

# 3. חטיפת hook ב-Claude Code / VS Code (פרויקט + גלובלי)
grep -rEn 'setup\.mjs|router_runtime|bun_environment' \
  .claude .vscode ~/.claude/settings.json ~/.claude/settings.local.json ~/.claude.json 2>/dev/null
grep -rn 'folderOpen' .vscode/tasks.json 2>/dev/null
# ובדקו ידנית את ה-hooks עצמם:
node -e "for(const f of ['.claude/settings.json','.claude/settings.local.json',require('os').homedir()+'/.claude/settings.json']){try{const h=require(require('path').resolve(f)).hooks;if(h)console.log(f,JSON.stringify(h))}catch{}}"

# 4. חתימות התולעת בכל קובץ
grep -rIn -e 'Sha1-Hulud' -e 'Shai-Hulud' -e 'SHA1HULUD' -e 'webhook.site' \
  -e 'The Second Coming' . --exclude-dir=.git --exclude-dir=node_modules 2>/dev/null

# 5. workflows לא צפויים + commit authors חשודים
find .github/workflows -name '*.yml' 2>/dev/null
git log --all --pretty='%an <%ae>' 2>/dev/null | sort -u | grep -iE 'hulud|torvalds'

# 6. מאגר האזהרות (כמו Snyk) — תופס malware שכבר דווח
npm audit

# 7. כלל 7 הימים — האם תלות ישירה כלשהי פורסמה בשבוע האחרון?
node -e '
const fs=require("fs"),cp=require("child_process"),NOW=Date.now();
const p=JSON.parse(fs.readFileSync("package.json","utf8")),d={...p.dependencies,...p.devDependencies},f=[];
for(const n of Object.keys(d)){let v;try{v=JSON.parse(fs.readFileSync(`node_modules/${n}/package.json`,"utf8")).version}catch{continue}
let t;try{t=JSON.parse(cp.execSync(`npm view ${n} time --json 2>/dev/null`,{maxBuffer:1e7}))[v]}catch{continue}
if(t){const a=Math.floor((NOW-new Date(t))/864e5);if(a<7)f.push(`${n}@${v} ${a}d`)}}
console.log(f.length?"⚠️ <7d:\n  "+f.join("\n  "):"✅ אף תלות ישירה לא פורסמה ב-7 הימים האחרונים")'
```

---

## תוצאות הסריקה — 2026-06-02

| בדיקה | תוצאה |
|---|---|
| קבצי payload | ✅ נקי (רק `bin/commands/setup.mjs` הלגיטימי שלנו) |
| סקריפטי preinstall/postinstall זדוניים | ✅ נקי |
| `SessionStart` hook (פרויקט + גלובלי) | ✅ רק ה-hook שלנו (`cat REMINDERS.md`) |
| חתימות התולעת | ✅ אפס |
| workflows / commit authors | ✅ נקי |
| `npm audit` | 21 CVE רגילים (axios/next/postcss/ws…), **0 malware** |
| 47 תלויות ישירות — תאריך פרסום | ✅ אף אחת לא < 7 ימים |
| 51 חבילות editor/prosemirror/markdown שהותקנו היום | ✅ כולן ≥ 7 ימים |

**מסקנה: הריפו נקי מ-Shai-Hulud.** לא בוצע סיבוב טוקנים / מחיקה (אין צורך, ובגלל
ה-deadman switch לא מגיבים רפלקסיבית).

---

## מקורות

- [Microsoft Security — Shai-Hulud 2.0 guidance](https://www.microsoft.com/en-us/security/blog/2025/12/09/shai-hulud-2-0-guidance-for-detecting-investigating-and-defending-against-the-supply-chain-attack/)
- [Datadog Security Labs — Shai-Hulud 2.0 npm worm](https://securitylabs.datadoghq.com/articles/shai-hulud-2.0-npm-worm/) · [DataDog IOC repo + CSVs](https://github.com/DataDog/indicators-of-compromise/tree/main/shai-hulud-2.0)
- [Sonar — Mini Shai-Hulud Targets AI Coding Agents](https://www.sonarsource.com/blog/mini-shai-hulud-targets-ai-coding-agents)
- [Mend — Shai-Hulud SAP CAP via Claude Code](https://www.mend.io/blog/shai-hulud-sap-cap-supply-chain-attack-claude-code/)
- [StepSecurity — Mini Shai-Hulud / TeamPCP (TanStack)](https://www.stepsecurity.io/blog/mini-shai-hulud-is-back-a-self-spreading-supply-chain-attack-hits-the-npm-ecosystem)
- [Snyk — Mini Shai-Hulud @antv](https://snyk.io/blog/mini-shai-hulud-antv-npm-supply-chain-attack/) · [OX Security — TeamPCP copycats](https://www.ox.security/blog/new-actors-deploy-shai-hulud-clones-teampcp-copycats-are-here/)
- [Unit 42](https://unit42.paloaltonetworks.com/npm-supply-chain-attack/) · [ReversingLabs](https://www.reversinglabs.com/blog/new-shai-hulud-worm-spreads-what-to-know) · [The Hacker News — Miasma / Red Hat](https://thehackernews.com/2026/06/miasma-supply-chain-attack-compromises.html)
