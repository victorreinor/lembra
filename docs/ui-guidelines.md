# Guia de UI

Regras obrigatórias para qualquer interface do `lembra` (Fase 2 em diante). O objetivo é uma interface rápida, previsível e fácil de evoluir, tanto por pessoas quanto por agentes de IA.

## Princípios

1. **A busca é o produto.** O campo de busca abre focado, e o primeiro resultado chega em menos de 100 ms. Nada compete com ele na tela.
2. **Uma ação principal por contexto.** Na lista, abrir a sessão. No detalhe, retomar a sessão. Ações secundárias ficam visíveis, mas com menos peso.
3. **Tudo pelo teclado.** O mouse é opcional.
4. **Zero surpresa.** A mesma informação aparece sempre no mesmo lugar e com o mesmo componente da CLI: id curto, data, repo · branch, título.
5. **Os dados são do usuário.** Nenhum recurso externo em tempo de execução: sem CDN, sem fontes remotas, sem analytics.

## Heurísticas aplicadas

| Heurística (Nielsen) | Como aplicar no `lembra` |
|---|---|
| Visibilidade do status | Contador de resultados e tempo da busca; aviso "indexando…" quando o índice está sendo atualizado; selo `[só prompts]` em sessões vindas do histórico |
| Correspondência com o mundo real | Termos do Claude Code (sessão, prompt, `/compact`, resume) e datas em pt-BR (`14/10 10:31`, "há 2 dias") |
| Controle e liberdade | Filtros removíveis um a um (chips com ×); Esc limpa a busca; a URL guarda o estado (`?q=&repo=&since=`), o que permite voltar e compartilhar |
| Consistência e padrões | Um componente por conceito, sempre o mesmo (ver Componentes) |
| Prevenção de erros | `restore` nunca sobrescreve sem confirmação explícita; ações destrutivas não existem na v1 |
| Reconhecer em vez de lembrar | Sugestões de repo e branch a partir do índice; buscas recentes; atalhos visíveis em `<kbd>` |
| Flexibilidade e eficiência | Atalhos de teclado; sintaxe da CLI aceita na busca (`"frase exata"`, prefixos) |
| Estética e minimalismo | Uma coluna de resultados, trechos com destaque e metadados em texto secundário |
| Recuperação de erros | Estado vazio que explica o motivo e sugere a próxima ação ("Nenhum resultado em `billing`. Remover o filtro de repo?") |
| Ajuda | Painel `?` com atalhos e sintaxe de busca |

## Tokens de design

Todo valor visual vem de uma custom property CSS definida **só** em `src/web/styles/tokens.css`. Componentes nunca usam cor, espaçamento, raio, sombra ou duração literal.

```css
:root {
  /* cor: primitivos (nunca usados direto em componentes) */
  --gray-0: #ffffff; --gray-50: #f7f7f8; --gray-100: #ececef; --gray-300: #c9c9d1;
  --gray-500: #6e6e7a; --gray-700: #3b3b44; --gray-900: #16161a;
  --blue-500: #3b6cf6; --amber-300: #ffd666; --green-600: #1f9d55; --red-600: #d64545;

  /* cor: semânticos (os únicos usados em componentes) */
  --color-bg: var(--gray-0);
  --color-surface: var(--gray-50);
  --color-border: var(--gray-100);
  --color-text: var(--gray-900);
  --color-text-muted: var(--gray-500);
  --color-accent: var(--blue-500);
  --color-highlight: var(--amber-300);
  --color-success: var(--green-600);
  --color-danger: var(--red-600);
  --color-focus-ring: var(--blue-500);

  /* espaço: escala de 4 px */
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px; --space-6: 24px; --space-8: 32px;

  /* tipografia: fontes do sistema */
  --font-sans: system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, monospace;
  --text-xs: 12px; --text-sm: 13px; --text-md: 15px; --text-lg: 18px; --text-xl: 24px;
  --leading-tight: 1.25; --leading-normal: 1.5;

  /* forma, profundidade e movimento */
  --radius-sm: 4px; --radius-md: 8px; --radius-full: 999px;
  --shadow-sm: 0 1px 2px rgb(0 0 0 / 0.06); --shadow-md: 0 4px 16px rgb(0 0 0 / 0.08);
  --duration-fast: 120ms; --duration-normal: 200ms; --easing: cubic-bezier(0.2, 0, 0, 1);
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { --color-bg: var(--gray-900); --color-surface: #1e1e24; /* … */ }
}
:root[data-theme="dark"] { --color-bg: var(--gray-900); --color-surface: #1e1e24; /* … */ }

@media (prefers-reduced-motion: reduce) {
  :root { --duration-fast: 0ms; --duration-normal: 0ms; }
}
```

Regras:

- Componentes usam só tokens **semânticos** (`--color-text`, nunca `--gray-900`). Trocar o tema muda só o `tokens.css`.
- O modo escuro redefine apenas os tokens semânticos, nunca o CSS dos componentes.
- Um token novo entra primeiro no `tokens.css`, com comentário dizendo onde é usado.

## Componentes

Cada componente vive em `src/web/components/<nome>/` com `<nome>.ts` (Web Component ou função que devolve HTML), `<nome>.css` e um exemplo de uso no topo do arquivo. Não pode haver estilo de componente fora da pasta dele.

| Componente | Responsabilidade |
|---|---|
| `SearchBar` | Campo principal, atalho `/`, debounce de 120 ms, aceita a sintaxe da CLI |
| `FilterChip` | Filtro ativo (repo, branch, período) com botão de remover |
| `SessionCard` | Id curto, data, repo · branch, título, contagem de prompts e selo `[só prompts]` |
| `Snippet` | Trecho com `<mark>` nos termos (a partir dos marcadores `\x01…\x02` do core) e ícone do papel: prompt, resposta ou resumo |
| `PromptList` | Prompts de uma sessão, numerados, com expandir e recolher |
| `FileRow` | Caminho, tipo, status (no disco, apagado, imagem) e ações de restaurar e baixar |
| `Badge` | Rótulos curtos de status; variante definida por token |
| `Button` | Variantes `primary`, `secondary` e `ghost`; ícone opcional; estado de carregando |
| `CopyButton` | Copia o texto (ex.: `claude --resume`) e mostra "Copiado" por 2 s via `Toast` |
| `EmptyState` | Explica por que não há nada e sugere a próxima ação |
| `Toast` | Feedback curto e não bloqueante, com `aria-live="polite"` |
| `Kbd` | Mostra atalhos de teclado |

## Acessibilidade (WCAG 2.2 AA)

- Contraste mínimo de 4.5:1 para texto e 3:1 para componentes e foco, conferido nos dois temas.
- Foco sempre visível (`outline` com `--color-focus-ring`); nunca use `outline: none` sem substituto.
- HTML semântico primeiro (`<button>`, `<a>`, `<mark>`, `<time datetime>`); ARIA só quando não houver elemento nativo.
- Alvos de clique com no mínimo 24×24 px.
- Movimento respeita `prefers-reduced-motion`.

## Atalhos

| Tecla | Ação |
|---|---|
| `/` | Focar a busca |
| `↑` `↓` ou `j` `k` | Navegar nos resultados |
| `Enter` | Abrir sessão |
| `c` | Copiar o comando de resume |
| `o` | Abrir no Terminal |
| `Esc` | Limpar a busca ou fechar o detalhe |
| `?` | Mostrar ajuda |

## Para agentes de IA

- Antes de criar um componente, procure em `src/web/components/`. Se já existir, reutilize e estenda.
- Nome do componente = nome da pasta = nome da classe CSS raiz (`.session-card`). Use `data-*` para estados (`data-state="missing"`), não classes avulsas.
- Os dados vêm só da API, que reaproveita `src/core`. Nada de SQL ou acesso a arquivos no front.
- Todo componente novo precisa de um teste de renderização e de um exemplo no topo do arquivo.
