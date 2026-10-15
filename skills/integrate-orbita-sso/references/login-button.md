# Órbita sign-in button

Every Órbita browser login integration includes its official mark next to a localized label such as **Continuar con Órbita** / **Continue with Órbita**. The owner requires the logo for subsequent integrations. A text-only button or a generic planet, orbit, emoji or icon-library glyph does not satisfy this requirement.

## Asset

Use an existing official Órbita asset in the application when available. Otherwise copy [the bundled official SVG](../assets/orbita.svg) into the app's public brand assets, for example `public/brands/orbita.svg`. The bundled artwork is the official Órbita mark.

Preserve its geometry, viewBox, aspect ratio and approved colors. Display the whole mark with `object-fit: contain`, usually 24–28 px, with space between mark and label. Use an official supplied variant when the background requires it; do not recolor or redraw it arbitrarily. Serve it locally instead of depending on a remote logo URL at login time.

## Placement and interaction

- When a credentials form also exists, place the Órbita action below the credentials submit button. Preserve the existing credential providers, fields and recovery links. A short translated alternative separator is optional.
- In an SSO-only login, use the branded Órbita action as the primary sign-in action. Do not add a credentials form solely to reproduce the mixed-login layout.
- Use the application's button styles, a visible keyboard focus state and a touch target at least 44 px high. Keep the label legible, the logo proportional and the layout usable on mobile and in every supported locale.
- Make a full browser navigation to the trusted app server's login route. The browser must not call the token endpoint or send a client secret. For Next.js, use an ordinary anchor or disable prefetch/client routing; background prefetch must not start authorization.
- An anchor should use native navigation semantics; a JavaScript button inside a credentials form must have `type="button"` so it does not submit that form. Persist an allowlisted presentation locale through server state.
- With visible text naming Órbita, treat the logo as decorative (`alt=""`, `aria-hidden="true"`). Give the control one accessible name through its visible label.

Example markup after the existing submit control (adapt styles and translated text to the app):

```html
<a class="orbita-sign-in" href="/auth/orbita/login">
  <img src="/brands/orbita.svg" width="28" height="28" alt="" aria-hidden="true">
  <span>Continuar con Órbita</span>
</a>
```

The route above is the SDK default. Respect the configured route prefix and application locale handling rather than inventing an external authorize URL in the UI.

## Verify

Inspect the actual rendered login at desktop/mobile sizes and in supported locales. Confirm that the asset loads, the complete mark is visible, the action is below the credential submit control when present, focus/keyboard activation work and activation navigates to the server login route and then Órbita. Distinguish these UI checks from a successful authenticated callback and from production deployment.
