# Guia de UI

Regras obrigatórias para a página do `lembra` (`src/web/ui`). O objetivo é uma interface rápida, previsível e fácil de evoluir, tanto por pessoas quanto por agentes de IA. Para ver a página com dados fictícios, rode `bun run demo`.

## Conceito: o fichário do arquivista

Cada sessão é uma **ficha** com uma aba colorida pelo repositório (o tom sai de um hash do nome, então o mesmo repo tem sempre a mesma cor). Os dias aparecem como **carimbos** levemente tortos ("HOJE", "SEG · 19 OUT"). O destaque da busca imita **marca-texto**. Durante o dia, o fundo é papel quente; à noite, um "arquivo" azul-tinta. Há uma única cor de destaque, o azul do ícone.

- **Títulos:** Newsreader, uma serifa editorial.
- **Texto:** IBM Plex Sans.
- **Ids, datas, caminhos e rótulos:** IBM Plex Mono.

As fontes são empacotadas na página (só o subset latino, que cobre o português); nada vem da rede.

## Princípios

1. **A busca é o produto.** O campo fica no topo, `/` foca nele, e a resposta chega em milissegundos. Nada compete com ele.
2. **Uma ação principal por contexto.** Na lista, abrir a sessão. No detalhe, retomar no Terminal. As ações secundárias ficam visíveis, mas com menos peso.
3. **Tudo pelo teclado.** O mouse é opcional.
4. **Zero surpresa.** A informação aparece sempre igual, e igual à CLI: id curto, hora, repo · branch, título.
5. **Os dados são do usuário.** Nenhum recurso externo em tempo de execução: sem CDN, fontes remotas ou analytics.
6. **Dois idiomas, nenhuma frase fixa.** Todo texto vem de `src/i18n/ui.ts` (ver [i18n.md](i18n.md)).

## Heurísticas aplicadas

| Heurística (Nielsen) | Como está aplicada |
|---|---|
| Visibilidade do status | Contagem e tempo da busca; barra de progresso enquanto a lista recarrega; esqueleto no primeiro carregamento; "indexado há X" no rodapé; selo `só prompts` |
| Correspondência com o mundo real | Termos do Claude Code (sessão, prompt, `/compact`, resume) e datas no formato do idioma |
| Controle e liberdade | Filtros com "Limpar filtros"; `Esc` limpa a busca e fecha o detalhe; estado na URL (voltar e avançar funcionam, e a URL pode ser compartilhada) |
| Consistência e padrões | Um componente por conceito, reutilizado em todas as visões |
| Prevenção de erros | Restaurar nunca sobrescreve; ações destrutivas não existem |
| Reconhecer em vez de lembrar | Repos e branches sugeridos pelo índice; atalhos visíveis nos botões (`<kbd>`) |
| Flexibilidade e eficiência | Atalhos; sintaxe de busca da CLI (`"frase exata"`, prefixos) |
| Estética e minimalismo | Uma coluna de resultados, trechos com destaque, metadados em texto secundário |
| Recuperação de erros | Estados vazios que explicam o motivo e oferecem a próxima ação |
| Ajuda | Diálogo `?` com atalhos e sintaxe de busca |

## Tokens de design

Todo valor visual vem de uma custom property CSS definida **só** em `src/web/ui/styles/tokens.css`. Componentes nunca usam cor, espaçamento, raio, sombra ou duração literal.

- **Primitivos** (`--paper-*`, `--ink-*`, `--night-*`, `--blue-*`…): nunca usados direto em componentes.
- **Semânticos** (`--color-bg`, `--color-surface`, `--color-text`, `--color-accent`, `--color-highlight`, `--color-danger`…): os únicos usados em componentes.
- **Escalas:**
  - espaço: `--space-*`, escala de 4 px;
  - tipografia: `--text-*`, `--leading-*`, `--weight-*`, `--font-display`, `--font-sans` e `--font-mono`;
  - forma e profundidade: `--radius-*` e `--shadow-*`;
  - movimento: `--duration-*`, `--easing` e `--stagger`.
- **Aba do repositório:** `oklch(var(--repo-lightness) var(--repo-chroma) var(--repo-hue))`. O componente só define `--repo-hue`.
- **Modo escuro:** redefine apenas os tokens semânticos, duas vezes: em `prefers-color-scheme: dark` (sem escolha explícita) e em `:root[data-theme="dark"]` (escolha no rodapé).
- **`prefers-reduced-motion`** zera as durações.

Um token novo entra primeiro em `tokens.css`, nos dois temas.

## Componentes

Cada componente vive em `src/web/ui/components/<nome>/` com `<nome>.ts` (uma função que devolve elementos, com exemplo de uso no comentário do topo) e `<nome>.css` (estilos com a classe raiz `.<nome>`, importados em `styles/index.css`). Não pode haver estilo de componente fora da pasta dele.

| Componente | Responsabilidade |
|---|---|
| `search-bar` | Campo principal, `/` para focar, `↓` desce para os resultados |
| `tabs` | Sessões · Arquivos · Pendências |
| `filter-bar` | Repo, branch, período e um interruptor, conforme a visão (`VIEW_FILTERS`) |
| `session-card` | Ficha da sessão: aba do repo, título, metadados, selos e trechos |
| `snippet` | Trecho com `<mark>` nos termos e quem falou |
| `day-divider` | Carimbo de data entre grupos de sessões recentes |
| `session-detail` | Cabeçalho, ações, comando, resumo, conversa e arquivos |
| `prompt-list` | Conversa numerada; textos longos recolhidos; resumos do `/compact` em `<details>` |
| `file-row` | Caminho (a pasta encolhe, o nome nunca), estado e ações ver, baixar e restaurar |
| `pending-list` | Branches com trabalho não entregue e link para a última sessão |
| `status-bar` | Números do cofre, seletor de idioma, tema e ajuda |
| `help-dialog` | Atalhos e sintaxe de busca |
| `button`, `badge`, `kbd`, `toast`, `empty-state`, `skeleton` | Peças básicas reutilizadas pelos demais |

O texto chega por `t` (`lib/i18n.ts`), que é lido na hora de renderizar. A troca de idioma recarrega a página.

## Acessibilidade (WCAG 2.2 AA)

- Contraste mínimo de 4.5:1 para texto e 3:1 para componentes e foco, nos dois temas.
- Foco sempre visível (`:focus-visible` com `--color-focus-ring`).
- HTML semântico primeiro (`<button>`, `<a>`, `<mark>`, `<time datetime>`, `<dialog>`, `role="search"`); ARIA só quando falta um elemento nativo (`aria-current`, `aria-pressed`, `aria-live` nos avisos).
- Alvos de clique com no mínimo 24×24 px (`--target-min`).
- `lang` do `<html>` segue o idioma da página.
- `h()` cria só nós de texto: conteúdo de transcripts nunca vira HTML.

## Atalhos

| Tecla | Ação |
|---|---|
| `/` | Focar a busca |
| `↓` `↑` ou `j` `k` | Navegar nos resultados |
| `Enter` | Abrir a sessão |
| `o` | Retomar no Terminal |
| `c` | Copiar o comando de resume |
| `h` | Copiar o handoff |
| `1` `2` `3` | Sessões, arquivos, pendências |
| `Esc` | Limpar a busca, fechar o detalhe ou o diálogo |
| `?` | Ajuda |

## Para agentes de IA

- Antes de criar um componente, procure em `components/`. Se já existir, reutilize e estenda.
- Nome do componente = nome da pasta = classe CSS raiz. Estados vão em `data-*` (`data-status="missing"`), não em classes avulsas.
- A página só fala com a API (`lib/api.ts`), que reaproveita `src/core`. Nada de SQL ou acesso a arquivos no front.
- Todo texto novo entra em `src/i18n/ui.ts` nos dois idiomas.
- Todo componente novo precisa de um teste em `test/web/components.test.ts`.
- Mudou algo visual? Confira com `bun run demo` nos dois temas e nos dois idiomas.
