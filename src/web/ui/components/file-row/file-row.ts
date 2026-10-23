import { h, replace } from "../../lib/dom";
import { bytes, clock, dayStamp } from "../../lib/format";
import type { FileDTO } from "../../../types";
import { Badge, type BadgeTone } from "../badge/badge";
import { Button, whileBusy } from "../button/button";
import { toast } from "../toast/toast";

const KIND_LABEL: Record<FileDTO["kind"], string> = { write: "criou", edit: "editou", read: "leu", image: "imagem", ref: "citado" };
const STATUS: Record<FileDTO["status"], [string, BadgeTone]> = {
  disk: ["no disco", "neutral"],
  missing: ["apagado do disco", "danger"],
  image: ["imagem colada", "neutral"],
  partial: ["sem conteúdo completo", "warning"],
};

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
  const status = h("span", { class: "file-row__status" }, Badge(...STATUS[file.status]));
  const hasContent = file.status !== "partial";

  const restore =
    file.status === "missing" &&
    Button({
      label: "Restaurar",
      icon: "restore",
      size: "sm",
      onClick: (event) => {
        const button = event.currentTarget as HTMLElement;
        void whileBusy(button, async () => {
          try {
            const { displayDest } = await onRestore(file.id);
            replace(status, Badge("restaurado", "success"));
            button.remove();
            toast(`Restaurado em ${displayDest}`, "success");
          } catch (error) {
            toast((error as Error).message, "danger");
          }
        });
      },
    });

  return h(
    "li",
    { class: "file-row", dataset: { status: file.status } },
    h("span", { class: "file-row__kind" }, KIND_LABEL[file.kind]),
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
        file.versions > 1 && ` · ${file.versions} versões`,
        showRepo && ` · ${file.repoName}`,
      ),
    ),
    status,
    h(
      "span",
      { class: "file-row__actions" },
      hasContent && Button({ label: "Ver conteúdo", icon: "eye", size: "sm", variant: "ghost", iconOnly: true, href: rawUrl(file.id, false), newTab: true }),
      hasContent && Button({ label: "Baixar", icon: "download", size: "sm", variant: "ghost", iconOnly: true, href: rawUrl(file.id, true), download: true }),
      restore,
    ),
  );
}
