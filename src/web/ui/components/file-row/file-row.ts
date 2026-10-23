import { h, replace } from "../../lib/dom";
import { bytes, clock, dayStamp } from "../../lib/format";
import { t } from "../../lib/i18n";
import type { FileDTO } from "../../../types";
import { Badge, type BadgeTone } from "../badge/badge";
import { Button, whileBusy } from "../button/button";
import { toast } from "../toast/toast";

const STATUS_TONE: Record<FileDTO["status"], BadgeTone> = { disk: "neutral", missing: "danger", image: "neutral", partial: "warning" };

/**
 * One stored file with view, download and (when gone from disk) restore.
 * Example: FileRow({ file, rawUrl: (id, download) => …, onRestore: (id) => api.restore(id) })
 */
export interface FileRowProps {
  file: FileDTO;
  showRepo?: boolean;
  rawUrl(id: number, download: boolean): string;
  onRestore(id: number): Promise<{ displayDest: string }>;
}

export function FileRow({ file, showRepo, rawUrl, onRestore }: FileRowProps): HTMLElement {
  const slash = file.displayPath.lastIndexOf("/");
  const status = h("span", { class: "file-row__status" }, Badge(t.file.status[file.status], STATUS_TONE[file.status]));
  const hasContent = file.status !== "partial";

  const restore =
    file.status === "missing" &&
    Button({
      label: t.file.restore,
      icon: "restore",
      size: "sm",
      onClick: (event) => {
        const button = event.currentTarget as HTMLElement;
        void whileBusy(button, async () => {
          try {
            const { displayDest } = await onRestore(file.id);
            replace(status, Badge(t.file.restored, "success"));
            button.remove();
            toast(t.file.restoredTo(displayDest), "success");
          } catch (error) {
            toast((error as Error).message, "danger");
          }
        });
      },
    });

  return h(
    "li",
    { class: "file-row", dataset: { status: file.status } },
    h("span", { class: "file-row__kind" }, t.file.kinds[file.kind]),
    h(
      "span",
      { class: "file-row__main" },
      h(
        "span",
        { class: "file-row__path", title: file.path },
        slash >= 0 && h("span", { class: "file-row__dir" }, file.displayPath.slice(0, slash + 1)),
        h("span", { class: "file-row__name" }, file.displayPath.slice(slash + 1)),
      ),
      h(
        "span",
        { class: "file-row__meta" },
        `${dayStamp(file.ts).toLowerCase()} ${clock(file.ts)} · ${bytes(file.size)}`,
        file.versions > 1 && ` · ${t.file.versions(file.versions)}`,
        showRepo && ` · ${file.repoName}`,
      ),
    ),
    status,
    h("span", { class: "file-row__secrets" }, file.secrets > 0 && Badge(t.file.secrets(file.secrets), "warning", "alert")),
    h(
      "span",
      { class: "file-row__actions" },
      hasContent && Button({ label: t.file.view, icon: "eye", size: "sm", variant: "ghost", iconOnly: true, href: rawUrl(file.id, false), newTab: true }),
      hasContent && Button({ label: t.file.download, icon: "download", size: "sm", variant: "ghost", iconOnly: true, href: rawUrl(file.id, true), download: true }),
      restore,
    ),
  );
}
