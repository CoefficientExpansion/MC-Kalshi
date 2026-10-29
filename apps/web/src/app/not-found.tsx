import { Notice } from "@/components/market/notice";

export default function NotFound() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8 sm:px-8">
      <Notice
        title="Page not found"
        headingLevel={1}
        action={{ href: "/", label: "See all markets" }}
      >
        We could not find that page. The market may have moved, or the link may be wrong.
      </Notice>
    </div>
  );
}
