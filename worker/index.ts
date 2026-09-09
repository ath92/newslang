export default {
  fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json({ ok: true, env: env.APP_ENV ?? "production" });
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
