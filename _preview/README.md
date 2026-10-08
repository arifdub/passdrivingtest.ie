# Looking at a screen at phone width

`npm run check` proves the code runs. It says nothing about whether a screen
is usable on a phone, and that is how a booking sheet shipped showing a
hundred and twenty time chips in one scroll.

This renders one component at 390px and 320px against a local server that
answers the Supabase RPCs, photographs it, and measures the things that are
easy to get wrong and impossible to notice from source:

- does the page scroll sideways
- how many times are reachable without scrolling
- any tap target under 40px

The data layer is NOT stubbed. The real supabase client is pointed at
`localhost:5599`, so what gets photographed is the production code path —
same fetch, same parsing, same empty-state branches — rather than a version
of the screen that only exists in a test.

    npx vite build --config _preview/vite.config.js
    node _preview/shoot.mjs <output-directory>

To look at a different screen, change the import in `entry.jsx` and add
whatever RPCs it calls to the `rpc` handler in `shoot.mjs`.

Nothing here is built or deployed: `vite.config.js` at the project root
lists its entry points explicitly, and `_preview` is not among them.
