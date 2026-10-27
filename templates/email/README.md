# Email templates: rules for custom design

**Read this carefully before changing any file in this directory.** You may change everything visual and every word of copy. You may NOT remove, rename or move the required parts listed below. If you do, the server refuses to start (by design), so a broken email never reaches a user.

## How it works

- These are the **default** templates, written in Handlebars (`.hbs`).
- To change them, edit these files, or set `EMAIL_TEMPLATES_DIR` to your own folder with the same file names.
- A file missing from your folder uses the default from here. You can override only `layout.hbs`, or just a few emails.
- Templates are loaded once at startup. **Restart the server after any change.**

## What the server checks at startup

If any check fails, the server **stops booting** and prints which file and which variable is wrong.

1. Every template compiles and renders (no syntax errors, no missing files, no unknown partials or helpers).
2. `layout.hbs` renders **both** `{{> body}}` and `{{> footer}}`.
3. Every email prints its **required variables** (table below). The action link must be the `href` of a link.
4. No template uses unescaped output: `{{{value}}}` and `{{&value}}` are **rejected**.
5. `config.json` is valid: a safe `fromName` (if set), and a subject for every email.

## What you must check yourself

- The email looks right in Gmail, Outlook and Apple Mail.
- Images load (absolute `https://` URLs only).
- The footer wording fits.
- All four OTP wordings exist and make sense.

After a design change, **send yourself every email** and click every button (see the checklist below).

## Files

The file names are fixed.

| File | Email | Sent by |
| :--- | :--- | :--- |
| `layout.hbs` | Shared HTML shell for every email | partial named `layout` |
| `verification.hbs` | Sign-up email verification | `sendVerificationEmail` |
| `password-reset.hbs` | Password reset link | `sendPasswordResetEmail` |
| `otp.hbs` | One-time code, for all four OTP types | `sendOtpEmail` |
| `change-email-confirmation.hbs` | Approval link sent to the **current** address | `sendChangeEmailConfirmationEmail` |
| `change-email-verification.hbs` | Confirmation link sent to the **new** address | `sendChangeEmailVerificationEmail` |
| `config.json` | Sender name and one subject per email | all of the above |

**Don't rename these files or add new ones.** The server reads only these names.

## Variables

Always use double braces, e.g. `{{name}}`. Every value is HTML-escaped.

| Variable | Value | Available in |
| :--- | :--- | :--- |
| `{{subject}}` | The rendered subject line | every email (use it in `layout.hbs`) |
| `{{name}}` | The user's name, or empty. Greet with `{{#if name}}Hello {{name}},{{else}}Hello,{{/if}}` | verification, password-reset, both change-email |
| `{{url}}` | The action link (verify, reset, approve, confirm) | verification, password-reset, both change-email |
| `{{expiresIn}}` | How long the link or code is valid, in English, e.g. `1 hour`, `5 minutes` | every email |
| `{{expiresInDe}}` | The same in German, e.g. `1 Stunde`, `5 Minuten`, for bilingual designs | every email |
| `{{email}}` | The **new** address being confirmed | change-email-verification |
| `{{newEmail}}` | The address the user wants to switch to | change-email-confirmation |
| `{{otp}}` | The one-time code | otp |
| `{{otpType}}` | `sign-in`, `email-verification`, `forget-password` or `change-email` | otp |

- A variable used in the wrong file prints as an empty string, with no error.
- There are **no brand variables**. Write the company name, colors, logo and links directly into the templates.
- Don't invent variables. The server won't fill them.

## Required in each file

Checked at startup, unless marked "not checked".

| File | Must contain | Optional |
| :--- | :--- | :--- |
| `layout.hbs` | `{{> body}}` once, `{{> footer}}` once | `{{subject}}` in `<title>` and as the heading (recommended, not checked) |
| `verification.hbs` | `href="{{url}}"`, `{{expiresIn}}` | `{{name}}` |
| `password-reset.hbs` | `href="{{url}}"`, `{{expiresIn}}` | `{{name}}` |
| `change-email-verification.hbs` | `href="{{url}}"`, `{{email}}`, `{{expiresIn}}` | `{{name}}` |
| `change-email-confirmation.hbs` | `href="{{url}}"`, `{{newEmail}}`, `{{expiresIn}}` | `{{name}}` |
| `otp.hbs` | `{{otp}}`, `{{expiresIn}}` | all four `{{otpType}}` branches (keep them, not checked) |

**`href="{{url}}"` means exactly that:** `{{url}}` must be the whole `href` value of an `<a>` tag. Printing it as plain text fails the check. Showing it again as text under the button is fine, and recommended.

### `layout.hbs`

- A full HTML document, from `<!DOCTYPE html>` to `</html>`.
- `{{> body}}` goes in the main content area, `{{> footer}}` in the footer. Once each.
- Put `{{subject}}` in `<title>` and as the visible heading. Email files don't repeat the heading.

### `otp.hbs`

Keep all four branches, so the text matches what the user is doing:

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

Show `{{otp}}` large and outside the branches. The code is the point of this email.

The `change-email` code is sent only when email OTP's change-email option is turned on in `src/auth.ts`. It is off by default, but keep the branch.

### `config.json`

The only non-HTML file. It holds the sender name and the subjects:

```json
{
  "fromName": "Acme",
  "subjects": {
    "verification": "Verify your email address",
    "password-reset": "Reset your password"
  }
}
```

- **`fromName`**: the name shown next to the sender address, as in `Acme <no-reply@acme.com>`. Use `""` to show only the address. Not allowed: `< > " , ;` and line breaks. A `Name <address>` value in `EMAIL_FROM` wins over it.
- **`subjects`**: one subject per email. The keys are fixed: `verification`, `password-reset`, `change-email-verification`, `change-email-confirmation`, `otp-sign-in`, `otp-email-verification`, `otp-forget-password`, `otp-change-email`. Subjects are plain text (never HTML-escaped) and can use the variables above.
- In a custom folder, anything you leave out keeps its default. Omit `fromName` to keep the default name. Omit a subject key to keep that default subject.

## Structure of an email file

Every email file (all except `layout.hbs` and `config.json`) wraps the layout and defines two blocks, `body` and `footer`:

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

**Don't rename `layout`, `body` or `footer`.** If you leave out the `footer` block, the footer is empty. The server doesn't catch this.

## Hard rules

1. **Double braces only.** `{{{value}}}` and `{{&value}}` turn off HTML escaping, so a user's name could inject markup. The server rejects them.
2. **`eq` is the only helper**, as in `(eq otpType "sign-in")`. The only partials are `layout`, `body` and `footer`.
3. **Email-safe HTML.** Tables for layout and inline `style` attributes. No external CSS, JavaScript or web fonts. Keep the `<!--[if mso]>` blocks if you support Outlook.
4. **Images use absolute `https://` URLs** on your own host. No relative paths, `cid:` or `data:`.
5. **Never replace `{{url}}` with a fixed link.** Each link is unique to the user and the request.
6. **Never use the em dash character.** Use a comma, a colon or a new sentence.

## Checklist for a new design

1. Keep every file name and every subject key in `config.json`.
2. Rewrite `layout.hbs`. Keep `{{subject}}`, `{{> body}}` and `{{> footer}}`.
3. Rewrite each email file. Keep its required items and the `body` and `footer` blocks.
4. In `otp.hbs`, keep `{{otp}}` and all four `otpType` branches.
5. If the brand changes, update `fromName` and the subjects in `config.json`.
6. Restart the server. If it stops, the error names the file and the missing variable.
7. Send yourself every email: sign up, reset a password, change your email (both emails), and each OTP flow you use. Click every button and check where it lands.

## For AI agents

When asked to apply a new design here:

- Read this whole file first. "Required in each file" and "Hard rules" are not negotiable.
- Change markup, styling and copy freely. Never remove a required variable or move it out of its role. Never replace `{{url}}` with a fixed link or `{{otp}}` with a fixed code.
- Keep the file names, the `layout` / `body` / `footer` structure and the `config.json` subject keys.
- Don't edit `src/` to make a design fit. If the design needs a variable that isn't listed here, **say so and stop**. Don't invent one.
- Don't add new files here expecting the server to use them.
- After editing, run `bun test src/lib/email-templates.test.ts` and report any failure. For a custom folder, start the server with `EMAIL_TEMPLATES_DIR` pointing at it and report the startup log.
- In your summary, list the required variables each changed file still contains, so the user can check.
