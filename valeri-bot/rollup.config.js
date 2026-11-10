import typescript from 'rollup-plugin-typescript2'

// Empaqueta src/ en un único dist/app.js (como paula-bot).
// Las dependencias de node_modules quedan externas: se resuelven en tiempo de ejecución.
export default {
  input: 'src/app.ts',
  output: {
    file: 'dist/app.js',
    format: 'esm',
    sourcemap: true,
  },
  external: (id) => !id.startsWith('.') && !id.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(id),
  onwarn: (warning, warn) => {
    if (warning.code === 'UNRESOLVED_IMPORT') return
    warn(warning)
  },
  plugins: [typescript({ clean: true })],
}
