"use client";
import { defineRouteConfig } from "@medusajs/admin-sdk";
import { Container, Heading } from "@medusajs/ui";
import { Beaker } from "@medusajs/icons";

import { AssistantFeedbackSection } from "./components/AssistantFeedbackSection";
import { AssistantTurnFeedbackSection } from "./components/AssistantTurnFeedbackSection";
import { NpsCard } from "../../assistant/components/NpsCard";

const MetricsPage = () => {
  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h1">AI Metrics</Heading>
      </div>

      <div className="space-y-4 px-6 py-4">
        <NpsCard />
        <AssistantTurnFeedbackSection />
        <AssistantFeedbackSection />
      </div>
    </Container>
  );
};


export const config = defineRouteConfig({ label: "AI Metrics", icon: Beaker });
export default MetricsPage;
