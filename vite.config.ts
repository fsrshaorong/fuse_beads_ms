import { defineConfig } from 'vite';

export default defineConfig({
    base: './',
    server: {
        proxy: { '/socket.io': { target: 'http://127.0.0.1:2567', ws: true } }
    },
    build: {
        target: 'es2022',
        rollupOptions: {
            output: {
                manualChunks: {
                    three: ['three']
                }
            }
        }
    }
});
