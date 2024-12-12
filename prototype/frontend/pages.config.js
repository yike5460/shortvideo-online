module.exports = {
  // Build configuration
  build: {
    command: "npm run build",
    outputDirectory: "out",
    environment: {
      NODE_VERSION: "18"
    }
  },

  // Routes configuration for SPA
  routes: [
    {
      pattern: "**/*",
      script: `
        // Handle client-side routing
        const parsedUrl = new URL(request.url);
        const pathname = parsedUrl.pathname;
        
        // If the request is for a static asset, serve it directly
        if (pathname.match(/\.(js|css|png|jpg|jpeg|gif|ico|svg)$/)) {
          return fetch(request);
        }
        
        // Otherwise, serve the index.html file
        return new Response(
          await fetch(new URL("/index.html", request.url)),
          {
            headers: { "Content-Type": "text/html" },
          }
        );
      `
    }
  ]
} 