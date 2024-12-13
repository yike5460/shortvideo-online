// This is the main Worker function that handles incoming requests
export default {
    async fetch(request, env, ctx) {
      // env.ASSETS refers to Cloudflare's built-in asset serving functionality
      // This line forwards the request to serve static assets from your Next.js build
      return await env.ASSETS.fetch(request);
    }
  };
  
// Configuration object for Cloudflare Worker
export const config = {
    // This specific flag enables Node.js compatibility mode, allowing your Next.js application to use Node.js built-in modules that would otherwise be unavailable in the Workers environment
    compatibility_flags: ["nodejs_compat"]
};