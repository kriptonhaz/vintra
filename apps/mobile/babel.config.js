/**
 * Expo SDK 52 with Expo Router + Tamagui.
 *
 *   - `babel-preset-expo` handles JSX, TS, Hermes, and the new React Native
 *     architecture (Reanimated worklets are included automatically).
 *   - Tamagui's compiler plugin runs at build time to flatten styled
 *     components into plain View/Text + inline styles. Big perf win on
 *     low-end Android.
 */
module.exports = function (api) {
  api.cache(true)
  return {
    presets: [
      [
        'babel-preset-expo',
        {
          jsxImportSource: 'react',
        },
      ],
    ],
    plugins: [
      [
        '@tamagui/babel-plugin',
        {
          components: ['tamagui'],
          config: './tamagui.config.ts',
          logTimings: true,
          disableExtraction: process.env.NODE_ENV === 'development',
        },
      ],
    ],
  }
}
