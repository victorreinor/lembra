export const HELP = `lembra — o histórico permanente e pesquisável do Claude Code

Uso
  lembra                        sessões mais recentes
  lembra <termos>               busca (atalho de "lembra search")
  lembra search <termos>        busca em prompts, respostas, resumos e títulos
  lembra list                   sessões por data
  lembra show <sessão>          prompts, arquivos e o comando para retomar
  lembra resume <sessão>        reabre a sessão no Claude Code, na pasta certa
  lembra files [trecho]         arquivos que o Claude criou, editou ou leu
  lembra restore <arquivo>      restaura um arquivo do cofre
  lembra cat <arquivo>          imprime um arquivo do cofre
  lembra index                  indexa e arquiva tudo (incremental)
  lembra stats                  tamanho do cofre e retenção do Claude Code

Opções
  -r, --repo <nome>            filtra por repositório (trecho do nome)
  -b, --branch <nome>          filtra por branch (trecho do nome)
      --since <data>           a partir de: 2026-10-01, 01/10, 7d, 2w, 3m
      --until <data>           até (inclusive)
  -p, --prompts                só os seus prompts (search)
      --missing                só arquivos que não existem mais no disco (files)
  -n, --limit <n>              quantidade de resultados
      --full                   prompts completos (show)
      --to <caminho>           destino do arquivo (restore)
  -f, --force                  sobrescreve o destino (restore)
      --print                  só mostra o comando, sem abrir (resume)

Exemplos
  lembra faturamento --repo billing --since 7d
  lembra "relatório mensal" --prompts
  lembra files .sql --missing
  lembra restore 1234 --to ~/Desktop
  lembra resume 3f2a

<sessão>  começo do id (3f2a) ou o nome dado com /rename
<arquivo> o #id mostrado em files/show, ou o caminho original`;
