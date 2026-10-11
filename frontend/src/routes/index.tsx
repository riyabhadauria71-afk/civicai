import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "CivicAI — Report an Issue in Your Neighbourhood" },
      {
        name: "description",
        content:
          "Send a photo of a street issue to your local response team and track your neighbourhood reports.",
      },
      { property: "og:title", content: "CivicAI — Report an Issue in Your Neighbourhood" },
      {
        property: "og:description",
        content:
          "A quick photo helps your local team spot and respond to issues around your neighbourhood.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: lazyRouteComponent(
    () => import("@/components/civicai/civic-dashboard"),
    "CivicDashboard",
  ),
});
