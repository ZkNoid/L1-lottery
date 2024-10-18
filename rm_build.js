import esbuild from 'esbuild';

esbuild.build({
  entryPoints: ['./build/src/Random/RandomManager.js'], // Replace with your main file path
  bundle: true,
  outfile: './dist/bundledRandomManager.js', // Output file
  platform: 'node', // For Node.js environment
  format: 'esm', // Output format (can be 'esm' or 'cjs')
  external: ['o1js', 'zkon-zkapp'], // External dependencies that you don't want to include in the bundle
  minify: true, // Optional: minify the output
}).catch(() => process.exit(1));