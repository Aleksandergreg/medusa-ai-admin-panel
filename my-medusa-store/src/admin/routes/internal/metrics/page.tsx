"use client";
import { defineRouteConfig } from "@medusajs/admin-sdk";
import { Container, Tabs } from "@medusajs/ui";
import { Beaker } from "@medusajs/icons";

import { AssistantFeedbackSection } from "./components/AssistantFeedbackSection";
import { AssistantTurnFeedbackSection } from "./components/AssistantTurnFeedbackSection";
import { NpsOverview } from "./components/NpsOverview";
import { MetricsHeader } from "./components/MetricsHeader";

const MetricsPage = () => {
  return (
    <Container className="divide-y p-0">
      <MetricsHeader />

      <div className="px-6 py-6">
        <NpsOverview />
      </div>

      <div className="px-6 py-6">
        <Tabs defaultValue="turns" className="w-full">
          <Tabs.List className="mb-6">
            <Tabs.Trigger value="turns">Turn Summaries</Tabs.Trigger>
            <Tabs.Trigger value="operations">Operation Details</Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="turns">
            <AssistantTurnFeedbackSection />
          </Tabs.Content>

          <Tabs.Content value="operations">
            <AssistantFeedbackSection />
          </Tabs.Content>
        </Tabs>
      </div>
    </Container>
  );
};

export const config = defineRouteConfig({ label: "AI Metrics", icon: Beaker });
export default MetricsPage;
