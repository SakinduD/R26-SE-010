// Shared react-joyride theming, used by every onboarding tour in the app
// (Dashboard, RPE's ScenarioSelect and RolePlaySession).
//
// Two things here are easy to get wrong, both discovered the hard way:
//
// 1. Joyride's tooltip/overlay portal to document.body, outside any page's
//    own CSS scope, so they can't inherit a page's theme tokens. A dark
//    tooltip reads fine against a light-mode page but all but disappears
//    against a dark-mode page's own dark backdrop dimming — so this stays a
//    fixed bright card instead, which pops against a dimmed backdrop
//    regardless of which theme that backdrop is.
//
// 2. primaryColor/backgroundColor/textColor/arrowColor/overlayColor/
//    scrollOffset are read from a top-level `options` prop on <Joyride>
//    (see getMergedStep in react-joyride's source) — NOT from `styles`.
//    Nesting them under `styles.options` compiles fine but every one of
//    them is silently ignored in favor of the library's own defaults
//    (e.g. a black primaryColor, scrollOffset: 20).
export const joyrideOptions = {
  zIndex: 10000,
  primaryColor: '#7C3AED',
  backgroundColor: '#FFFFFF',
  textColor: '#241E38',
  arrowColor: '#FFFFFF',
  overlayColor: 'rgba(6,8,12,0.72)',
  scrollOffset: 72, // clears the app shell's 48px sticky topbar (index.css .topbar)
}

export const joyrideStyles = {
  tooltip: { borderRadius: 12, fontSize: 13.5, padding: 20 },
  tooltipTitle: { fontSize: 15, fontWeight: 800, marginBottom: 4, color: '#241E38' },
  tooltipContent: { color: '#5E5678', padding: '8px 0' },
  tooltipFooter: { marginTop: 16 },
  buttonNext: { borderRadius: 8, fontSize: 12.5, fontWeight: 700, padding: '8px 16px', backgroundColor: '#7C3AED', color: '#fff' },
  buttonBack: { color: '#8D84A8', fontSize: 12.5, marginRight: 10 },
  buttonSkip: { color: '#8D84A8', fontSize: 12 },
  // The close "x" icon's fill comes from this color, not options.textColor
  // directly (see react-joyride's JoyrideTooltipCloseButton) — pin it
  // explicitly so it can't end up defaulting to something illegible.
  buttonClose: { color: '#241E38' },
}
