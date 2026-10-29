"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { LiveOrderTicket, type OrderTicketProps } from "./order-ticket";

// The market page's order ticket: LiveOrderTicket (3 s polling, quote = fill), plus a server
// refresh after each trade so the server-rendered parts (headline price, chart, position card,
// header balance) catch up without a reload.

export function MarketTradePanel(props: Omit<OrderTicketProps, "onTraded">) {
  const router = useRouter();
  const onTraded = useCallback(() => router.refresh(), [router]);
  return <LiveOrderTicket {...props} onTraded={onTraded} />;
}
