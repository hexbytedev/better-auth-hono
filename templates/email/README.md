# Email templates: the contract for replacing the design

**Read this fully before changing any file in this directory.** You may change everything visual and every word of copy. You may NOT remove, rename or move the required parts listed below. If you do, the server refuses to start (by design) rather than send a broken email to a user.

## How replacement works

- These are the **default** templates (Handlebars, `.hbs`).
- A project replaces them by editing these files, **or** by setting `EMAIL_TEMPLATES_DIR` to its own directory with the same file names.
- A file that is missing from the custom directory falls back to the one here, so a project can override only `layout.hbs`, or only a few emails.
- Templates are loaded once at startup. **Restart the server after any change.**

## What the server checks at startup

If any check fails, the server **stops booting** and prints which file and which variable is wrong.

1. Every template compiles and renders (no syntax errors, no missing files, no unknown partials or helpers).
2. `layout.hbs` renders **both** `{{> body}}` and `{{> footer}}`.
3. Every email prints its **required variables** (table below). The action link must be the `href` of a link or button.
4. No template uses unescaped output: `{{{value}}}` and `{{&value}}` are **rejected**.
5. `subjects.json` is a flat JSON object of strings and has a subject for every email.

## What the server cannot check (you must do it)

- Whether the email looks right in Gmail, Outlook and Apple Mail.
- Whether images load. Use absolute `https://` URLs only.
- Whether the footer wording is appropriate.
- Whether the four OTP wordings (`otpType`) are all present and make sense.

After changing a design, **send yourself every email** and click the button (checklist at the bottom).

## Files (names are fixed)

| File | Email | Sent by |
| :--- | :--- | :--- |
| `layout.hbs` | Shared HTML shell for every email | partial named `layout` |
| `verification.hbs` | Sign-up email verification | `sendVerificationEmail` |
| `password-reset.hbs` | Password reset link | `sendPasswordResetEmail` |
| `otp.hbs` | One-time code, all four OTP types | `sendOtpEmail` |
| `change-email-confirmation.hbs` | Approval link sent to the **current** address | `sendChangeEmailConfirmationEmail` |
| `change-email-verification.hbs` | Confirmation link sent to the **new** address | `sendChangeEmailVerificationEmail` |
| `subjects.json` | Subject line per email | all of the above |

**Do NOT rename these files and do NOT add new ones.** The server only looks for these exact names. A new file is never read.

## Variables

Use `{{name}}` (double braces) for every one of them. All are HTML-escaped automatically.

| Variable | Value | Set in |
| :--- | :--- | :--- |
| `{{subject}}` | The rendered subject line | every email (use it in `layout.hbs`) |
| `{{name}}` | The user's name, or `there` if they have none | verification, password-reset, both change-email |
| `{{url}}` | The action link (verify, reset, approve, confirm) | verification, password-reset, both change-email |
| `{{expiresIn}}` | Human readable lifetime, e.g. `1 hour`, `5 minutes` | every email |
| `{{email}}` | The **new** address being confirmed | change-email-verification only |
| `{{newEmail}}` | The address the user asked to switch to | change-email-confirmation only |
| `{{otp}}` | The one-time code | otp only |
| `{{otpType}}` | `sign-in`, `email-verification`, `forget-password` or `change-email` | otp only |

- Variables not listed for a file render as an **empty string**. There is no error, so do not rely on them.
- **No brand variables exist.** Company name, colors, logo and site URLs are NOT variables and NOT environment variables. Write them directly into the templates.
- Do not invent new variables. The server will not supply them.

## Required per file (enforced at startup unless noted)

| File | MUST contain | Optional |
| :--- | :--- | :--- |
| `layout.hbs` | `{{> body}}` once, `{{> footer}}` once | `{{subject}}` in `<title>` and as the heading (strongly recommended, not enforced) |
| `verification.hbs` | `href="{{url}}"`, `{{expiresIn}}` | `{{name}}` |
| `password-reset.hbs` | `href="{{url}}"`, `{{expiresIn}}` | `{{name}}` |
| `change-email-verification.hbs` | `href="{{url}}"`, `{{email}}`, `{{expiresIn}}` | `{{name}}` |
| `change-email-confirmation.hbs` | `href="{{url}}"`, `{{newEmail}}`, `{{expiresIn}}` | `{{name}}` |
| `otp.hbs` | `{{otp}}`, `{{expiresIn}}` | `{{otpType}}` branches (keep all four, not enforced) |

**`href="{{url}}"` means exactly that:** the variable is the whole value of the `href` attribute of an `<a>` tag. Printing `{{url}}` as plain text does not satisfy the check. Adding the link a second time as visible text under the button is fine and recommended.

### `layout.hbs`

- A complete HTML document: `<!DOCTYPE html>` through `</html>`.
- `{{> body}}` goes inside the main content area. `{{> footer}}` goes in the footer area. Each exactly once.
- Put `{{subject}}` in `<title>` and as the visible heading. The email files do **not** repeat the heading.

### `otp.hbs`

Keep all four branches so the wording matches what the user is doing:

```handlebars
{{#if (eq otpType "sign-in")}}
	...
{{else if (eq otpType "email-verification")}}
	...
{{else if (eq otpType "forget-password")}}
	...
{{else if (eq otpType "change-email")}}
	...
{{/if}}
```

Show `{{otp}}` prominently, outside the branches. The code is the whole point of this email.

### `subjects.json`

A flat JSON object, one string per key. **The keys are fixed:**

`verification`, `password-reset`, `change-email-verification`, `change-email-confirmation`, `otp-sign-in`, `otp-email-verification`, `otp-forget-password`, `otp-change-email`

Values are plain text (never HTML-escaped), e.g. `"Reset your password"`. They may use the variables above. In a custom directory, any key you omit keeps the default subject.

## Structure every email file must follow

Each email file (everything except `layout.hbs` and `subjects.json`) wraps the layout and defines exactly two blocks, `body` and `footer`:

```handlebars
{{#> layout}}
	{{#*inline "body"}}
		<p>Hello {{name}},</p>
		<a href="{{url}}" style="...">Button text</a>
		<p>This link will expire in {{expiresIn}}.</p>
	{{/inline}}
	{{#*inline "footer"}}
		If you didn't request this, you can ignore this email.
	{{/inline}}
{{/layout}}
```

**Do not rename `layout`, `body` or `footer`.** If an email file leaves out the `footer` block, that part of the email is silently empty (the server does not catch this).

## Hard rules

1. **Double braces only.** Never `{{{value}}}` or `{{&value}}`. They disable HTML escaping and let a user's name inject markup into the email. The server rejects them.
2. **The only helper is `eq`**, used as `(eq otpType "sign-in")`. No other helpers, no `{{> something}}` includes other than `layout`, `body` and `footer`.
3. **Email-safe HTML.** Table layout, inline `style` attributes, no external CSS, no JavaScript, no web fonts. Keep the `<!--[if mso]>` blocks if Outlook matters.
4. **Images are absolute `https://` URLs** hosted by the project. Never relative paths, never `cid:`, never `data:`.
5. **Never hardcode a link in place of `{{url}}`.** The link is per user and per request.
6. **Never write the em dash character.** Use a comma, colon or a separate sentence.

## Applying a new design: checklist

1. Keep every file name and every `subjects.json` key.
2. Rewrite `layout.hbs`: new shell, keeping `{{subject}}`, `{{> body}}`, `{{> footer}}`.
3. Rewrite each email file: new markup and copy, keeping its **required** items and the `body` / `footer` blocks.
4. In `otp.hbs`, keep all four `otpType` branches and `{{otp}}`.
5. Update `subjects.json` wording if the brand voice changes. Keep the keys.
6. Restart the server. If it exits, read the message: it names the file and the missing variable.
7. Send yourself every email: sign up, request a password reset, change your email (both messages), and each OTP flow if enabled. Click each button and confirm it lands on the right page.

## Instructions for an AI agent

When asked to apply a new design to these templates:

- **Read this whole file first.** Treat "Required per file" and "Hard rules" as non-negotiable.
- Change markup, styling and copy freely. Never delete, rename or relocate a required variable out of its role. Never replace `{{url}}` with a literal link or `{{otp}}` with a literal code.
- Keep the file names, the `layout` / `body` / `footer` structure and the `subjects.json` keys exactly.
- Do not edit anything under `src/` to make a design fit. If the design needs a variable that is not listed here, **say so and stop**. Do not invent one.
- Do not add new files to this directory expecting them to be used.
- After editing files in this directory, run `bun test src/lib/email-templates.test.ts` and report any failure. For a custom directory, start the server with `EMAIL_TEMPLATES_DIR` pointing at it and report the startup output.
- In your summary, list which required variables each changed file still contains, so the user can verify.
