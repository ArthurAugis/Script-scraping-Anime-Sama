import axios from 'axios';
import fs from 'fs';

async function getAllAnimesAndFilms() {
  let page = 1;
  const baseUrl = 'https://anime-sama.fr/catalogue/?type%5B0%5D=Anime&search=&page=';
  let mediaLinks = [];

  while (true) {
    try {
      const url = `${baseUrl}${page}`;
      const response = await axios.get(url);
      const data = response.data;

      const linkRegex = /<a[^>]+href="(https:\/\/anime-sama\.fr\/catalogue\/[^"]+)"[^>]*>/g;
      let match;
      let pageLinks = [];

      while ((match = linkRegex.exec(data)) !== null) {
        const link = match[1];

        if (!link.includes("https://anime-sama.fr/catalogue/'+url+'")) {
          pageLinks.push(link);
        }
      }

      if (pageLinks.length === 0) {
        break;
      }

      mediaLinks.push(...pageLinks);
      page++;

    } catch (error) {
      console.error(`❌ Erreur lors de la récupération de la page ${page} :`, error);
      break;
    }
  }

  console.log(`✅ Récupération terminée, total de liens trouvés : ${mediaLinks.length}`);

  await getSaisonsAnime(mediaLinks);
}

async function getSaisonsAnime(mediaLinks) {
  for (let mediaLink of mediaLinks) {
    try {
      let response = await axios.get(mediaLink);
      let pageContent = response.data;
      let matchSyno = pageContent.match(/<h2[^>]*>\s*Synopsis\s*<\/h2>\s*<p[^>]*>([^<]*)<\/p>/i);
      let synopsis = matchSyno[1];
      let matchGenres = pageContent.match(/<h2[^>]*>\s*Genres\s*<\/h2>\s*<a[^>]*>([^<]*)<\/a>/i);
      let genres = matchGenres[1];
      let genresArray = genres.split(', ');
      let matchTitreAlter = pageContent.match(/<h2[^>]*id="titreAlter"[^>]*>([^<]*)<\/h2>/i);
      let titreAlter = matchTitreAlter ? matchTitreAlter[1].trim() : null;
      if (titreAlter.length === 0) titreAlter = null;
      let titreAlterArray = [];
      if (titreAlter) {
        titreAlterArray = titreAlter.split(',');
      }

      let titleMatch = pageContent.match(/<h4[^>]*id="titreOeuvre"[^>]*>(.*?)<\/h4>/i);
      let animeTitle = titleMatch ? titleMatch[1].trim() : "Titre inconnu";
      let animeTitleSearch = animeTitle.replace(/ /g, '-');
      let responseAffiche = await axios.get("https://kitsu.app/api/edge/anime?filter[slug]=" + animeTitleSearch);
      let dataAffiche = responseAffiche.data;
      let affiche = "https://i.seadn.io/gae/2hDpuTi-0AMKvoZJGd-yKWvK4tKdQr_kLIpB_qSeMau2TNGCNidAosMEvrEXFO9G6tmlFlPQplpwiqirgrIPWnCKMvElaYgI-HiVvXc?auto=format&dpr=1&w=1000"
      if (dataAffiche.data[0]) {
        affiche = dataAffiche.data[0].attributes.posterImage.large;
      }

      if (/<h2 class="text-white text-xl font-bold uppercase border-b-2 mt-5 border-slate-500">Anime<\/h2>/i.test(pageContent)) {
        let saisonsDivMatch = pageContent.match(
          /<div[^>]*class="[^"]*flex[^"]*flex-wrap[^"]*overflow-y-hidden[^"]*justify-start[^"]*bg-slate-900[^"]*bg-opacity-70[^"]*rounded[^"]*mt-2[^"]*h-auto[^"]*"[^>]*>(.*?)<\/div>/is
        );

        if (saisonsDivMatch) {
          let saisonsDivContent = saisonsDivMatch[1];

          saisonsDivContent = saisonsDivContent.replace(/\/\*[\s\S]*?\*\//g, "");

          let panneauAnimeRegex = /panneauAnime\("([^"]+)",\s*"([^"]+)"\)|name\s*=\s*'([^']+)';\s*url\s*=\s*'([^']+)'/g;
          let panneauMatches = [];
          let match;

          while ((match = panneauAnimeRegex.exec(saisonsDivContent)) !== null) {
            let name, url;
            if (match[1] && match[2]) {
              name = match[1];
              url = match[2];
            } else if (match[3] && match[4]) {
              name = match[3];
              url = match[4];
            }

            if (name !== 'nom' && url !== 'url') {
              panneauMatches.push({ name, url });
            }
          }

          let json = { title: animeTitle, url: mediaLink, synopsis: synopsis, genres: genresArray, titreAlter: titreAlterArray, affiche: affiche, seasons: panneauMatches };

          let newJSON = JSON.parse(JSON.stringify(json));

          newJSON.seasons = newJSON.seasons.map(season => ({
            ...season,
            url: season.url.replace('vostfr', 'vf')
          }));

          await getEpisodesForAnime(json);
          await new Promise(resolve => setTimeout(resolve, 1000));
          await getEpisodesForAnime(newJSON);

        } else {
          console.log(`❌ No seasons found for ${animeTitle} (${mediaLink})`);
        }
      } else {
        console.log(`❌ "Anime" section NOT found on page: ${mediaLink}`);
      }
    } catch (error) {
      console.error(`❌ Failed to fetch ${mediaLink}:`, error.message);
    }
  }
}

async function getEpisodesForAnime(anime) {
  for (let season of anime.seasons) {
    console.log(`✅ ${anime.title} - ${season.name} - ${season.url}`);
    let seasonUrl = `${anime.url}/${season.url}`.replace(/ /g, '');

    try {
      let response = await axios.get(seasonUrl);
      let pageContent = response.data;

      let episodes = [];
      let methodUsed = null;
      let methodsTried = [];
      let lastInsert = 0;

      const episodeRegex = /(creerListe\((\d+),\s*(\d+)\))|(newSPF\("([^"]+)"\))/g;
      let specialIndex = 1;
      let match;
      while ((match = episodeRegex.exec(pageContent)) !== null) {
        if (match[2] && match[3]) {
          const debut = parseInt(match[2], 10);
          const fin = parseInt(match[3], 10);
          for (let i = debut; i <= fin; i++) {
            episodes.push({ number: i, title: `Episode ${i}` });
            lastInsert = i;
          }
          methodUsed = "creerListe()";
          if (!methodsTried.includes(methodUsed)) {
            methodsTried.push(methodUsed);
          }
        } else if (match[5]) {
          episodes.push({ type: "special", title: match[5], index: specialIndex++ });
          methodUsed = "newSPF()";
          if (!methodsTried.includes(methodUsed)) {
            methodsTried.push(methodUsed);
          }
        }
      }

      const finirListeOPRegex = /finirListeOP\((\d+)\)/;
      let opMatch = pageContent.match(finirListeOPRegex);
      if (opMatch) {
        let finishingStart = parseInt(opMatch[1], 10);
        if (!episodes.some(ep => ep.number === finishingStart)) {
          episodes.push({ number: finishingStart, title: `Episode ${finishingStart}` });
          lastInsert = finishingStart;
        }
        methodUsed = "finirListeOP()";
        if (!methodsTried.includes(methodUsed)) {
          methodsTried.push(methodUsed);
        }
      }

      const tailleEpisodesFallbackMatch = pageContent.match(/var\s+tailleEpisodes\s*=\s*(\d+)/);
      if (episodes.length === 0 && tailleEpisodesFallbackMatch) {
        const tailleEpisodes = parseInt(tailleEpisodesFallbackMatch[1], 10);
        for (let i = 1; i <= tailleEpisodes; i++) {
          episodes.push({ number: i, title: `Episode ${i}` });
        }
        methodUsed = "tailleEpisodes seule";
        methodsTried.push("tailleEpisodes seule");
      }

      let episodesJsUrl = `${seasonUrl}/episodes.js`;
      try {
        let epsResponse = await axios.get(episodesJsUrl);
        let epsContent = epsResponse.data;
        const epsRegex = /var\s+eps1\s*=\s*(\[[^\]]*\])/;
        let epsMatch = epsContent.match(epsRegex);
        if (epsMatch) {
          let arrayStr = epsMatch[1];
          arrayStr = arrayStr.replace(/,\s*(\]|\})/g, '$1')
            .replace(/[\n\r\t]/g, '')
            .replace(/,\s*\/\/.*?(?=,|\])/g, '')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/'/g, '"')
            .replace(/"(?=")/g, '')
            .replace(/,\s*([\]}])/g, '$1')
            .replace(/\[\/\/".*?",/, '[');

          let epsArray = JSON.parse(arrayStr);
          let totalEpisodesFromJS = epsArray.length;
          if (totalEpisodesFromJS > episodes.length) {
            for (let i = episodes.length + 1; i <= totalEpisodesFromJS; i++) {
              episodes.push({ number: lastInsert + 1, title: `Episode ${lastInsert + 1}` });
              lastInsert++;
            }
            methodUsed = "episodes.js ajouté manquants";
            methodsTried.push("episodes.js ajouté manquants");
          }
        } else if (season.url.endsWith("vostfr") && season.url !== "https://anime-sama.fr/catalogue/hinata-no-aoshigure/saison1/vostfr") {
          fs.appendFileSync(
            'logs.txt',
            `⚠️ ${anime.title} - ${season.name} - ${seasonUrl} - Le fichier episodes.js ne contient pas de tableau 'eps1'.\n`
          );
        }
      } catch (err) {
        fs.appendFileSync(
          'logs.txt',
          `❌ ${anime.title} - Erreur lors de la récupération de episodes.js pour ${season.name} : ${err.message}\n`
        );
      }

      if (episodes.length === 0) {
        if (methodsTried.length > 0) {
          fs.appendFileSync(
            'logs.txt',
            `❌ ${anime.title} - ${season.name} - ${seasonUrl} - Aucun épisode trouvé\n🔍 Méthodes essayées : ${methodsTried.join(", ") || "Aucune méthode disponible"}\n`
          );
        }
      } else {
        episodes = await addEpisodeUrls(episodes, seasonUrl);

        anime.seasons.forEach(saison => {
          if (saison.name === season.name) {
            saison.episodes = episodes;
          }
        });
      }

    } catch (error) {
      if (error.response && error.response.status !== 404) {
        fs.appendFileSync(
          'logs.txt',
          `❌ ${anime.title} - ${season.name} - Erreur lors de la récupération de ${seasonUrl} : ${error.message}\n`
        );
      }
    }
  }

  database(anime);
}






async function addEpisodeUrls(episodes, seasonUrl) {
  try {
    const episodesJsUrl = `${seasonUrl}/episodes.js`;
    const epsResponse = await axios.get(episodesJsUrl);
    const epsContent = epsResponse.data;

    const keys = ['eps1', 'eps2', 'eps3', 'eps4'];
    const epsArrays = {};

    keys.forEach(key => {
      const regex = new RegExp(`var\\s+${key}\\s*=\\s*(\\[[^\\]]*\\])`);
      const match = epsContent.match(regex);
      if (match) {
        let arrayStr = match[1];
        arrayStr = arrayStr.replace(/,\s*(\]|\})/g, '$1');
        arrayStr = arrayStr.replace(/[\n\r\t]/g, '');
        arrayStr = arrayStr.replace(/,\s*\/\/.*?(?=,|\])/g, '');
        arrayStr = arrayStr.replace(/\/\*[\s\S]*?\*\//g, '');
        arrayStr = arrayStr.replace(/'/g, '"');
        arrayStr = arrayStr.replace(/"(?=")/g, '');
        arrayStr = arrayStr.replace(/,\s*([\]}])/g, '$1');
        arrayStr = arrayStr.replace(/\[\/\/".*?",/, '[');

        try {
          epsArrays[key] = JSON.parse(arrayStr);
        } catch (err) {
          console.error(`Error parsing JSON for ${key}:`, err);
          epsArrays[key] = [];
        }
      } else {
        epsArrays[key] = [];
      }
    });

    const preferences = [
      "https://vidmoly.to/",
      "https://video.sibnet.ru",
      "https://sendvid.com",
      "https://vk.com",
      "https://www.youtube.com"
    ];

    episodes.forEach((episode, index) => {
      let episodeLinks = [];

      keys.forEach(key => {
        if (Array.isArray(epsArrays[key]) && epsArrays[key].length > index) {
          episodeLinks.push(epsArrays[key][index]);
        }
      });

      let bestLink = null;
      let bestPrefIndex = Infinity;

      episodeLinks.forEach(link => {
        for (let i = 0; i < preferences.length; i++) {
          if (link.startsWith(preferences[i]) && i < bestPrefIndex) {
            bestPrefIndex = i;
            bestLink = link;
          }
        }
      });

      if (!bestLink && episodeLinks.length > 0) {
        bestLink = episodeLinks[0];
      }

      episode.url = bestLink;
    });

    episodes = episodes.filter(episode => episode.url);
      
    return episodes;
  } catch (error) {
    console.error("Error while adding URLs to episodes:", error);
    return episodes;
  }
}


async function database(json) {
  let animeID = await addAnime(json.title, json.affiche, json.synopsis);
  await addGenres(json.genres, animeID);
  await addSubnames(json.titreAlter, animeID);
  await addSaisons(json.seasons, animeID);

}

async function addSaisons(saisonsArray, animeID) {
  let saison_number = 0;

  for (let saison of saisonsArray) {
    saison_number++;
    let nom_url = saison.name.replace(/ /g, "-").replace(/"/g, "-").replace(/'/g, "-");

    let sql = "SELECT * FROM tab_saisons WHERE nom = ? AND anime = ?";
    let result = await queryAsync(sql, [saison.name, animeID]);

    let saisonID;
    if (result.length === 0) {
      let insertSql = "INSERT INTO tab_saisons (nom, anime, nom_url, numero) VALUES (?, ?, ?, ?)";
      let insertResult = await queryAsync(insertSql, [saison.name, animeID, nom_url, saison_number]);
      saisonID = insertResult.insertId;
    } else {
      saisonID = result[0].id;
    }

    await checkIfEpisodes(saison, saisonID, animeID);
  }
}

async function checkIfEpisodes(saison, saisonID, animeID) {
  if (saison.episodes) {
    let langueID = saison.url.endsWith("vf") ? 2 : 1;
    await addLangueAnime(langueID, animeID);
    await addLangueSaison(langueID, saisonID);
    await addEpisode(saison.episodes, saisonID, langueID);
  }
}

async function addLangueAnime(langue, animeID) {
  let sql = "SELECT * FROM tab_parler WHERE anime = ? AND langue = ?";
  let result = await queryAsync(sql, [animeID, langue]);

  if (result.length === 0) {
    let insertSql = "INSERT INTO tab_parler (anime, langue) VALUES (?, ?)";
    await queryAsync(insertSql, [animeID, langue]);
  }
}

async function addLangueSaison(langue, saisonID) {
  let sql = "SELECT * FROM tab_saison_parler WHERE saison = ? AND langue = ?";
  let result = await queryAsync(sql, [saisonID, langue]);

  if (result.length === 0) {
    let insertSql = "INSERT INTO tab_saison_parler (saison, langue) VALUES (?, ?)";
    await queryAsync(insertSql, [saisonID, langue]);
  }
}

async function addEpisode(episodesArray, saisonID, langue) {
  let i = 0;
  for (let episode of episodesArray) {
    i++;
    let sql = "SELECT * FROM tab_episodes WHERE numero = ? AND saison = ? AND langue = ?";
    let result = await queryAsync(sql, [i, saisonID, langue]);
    let nom = episode.title;
    let nom_url = episode.title.replace(/ /g, "-").replace(/"/g, "-").replace(/'/g, "-");

    if (result.length === 0) {
      let insertSql = "INSERT INTO tab_episodes (numero, langue, saison, nom, nom_url, url) VALUES (?, ?, ?, ?, ?, ?)";
      await queryAsync(insertSql, [i, langue, saisonID, nom, nom_url, episode.url]);
    }
  }

}


async function addSubnames(subnamesArray, animeID) {
  for (let subname of subnamesArray) {
    let sql = "SELECT * FROM tab_subname WHERE subname = ? AND anime = ?";
    connection.query(sql, [subname, animeID], function (err, result) {
      if (err) throw err;
      if (result.length == 0) {
        let sql = "INSERT INTO tab_subname (subname, anime) VALUES (?, ?)";
        connection.query(sql, [subname, animeID], function (err, result) {
          if (err) throw err;
        });
      }
    });
  }
}

async function addGenres(genresArray, animeID) {

  for (let genre of genresArray) {
    let sql = "SELECT * FROM tab_categories WHERE nom = ?";
    connection.query(sql, [genre], function (err, result) {
      if (err) throw err;
      if (result.length == 0) {
        let sql = "INSERT INTO tab_categories (nom) VALUES (?)";
        connection.query(sql, [genre], function (err, result) {
          if (err) throw err;
          let sql = "SELECT * FROM tab_categories WHERE nom = ?";
          connection.query(sql, [genre], function (err, result) {
            if (err) throw err;
            let genreID = result[0].id;
            let sql = "SELECT * FROM tab_categoriser WHERE anime = ? AND categorie = ?";
            connection.query(sql, [animeID, genreID], function (err, result) {
              if (err) throw err;
              if (result.length == 0) {
                let sql = "INSERT INTO tab_categoriser (anime, categorie) VALUES (?, ?)";
                connection.query(sql, [animeID, genreID], function (err, result) {
                  if (err) throw err;
                });
              }
            });
          });
        });
      } else {
        let genreID = result[0].id;
        let sql = "SELECT * FROM tab_categoriser WHERE anime = ? AND categorie = ?";
        connection.query(sql, [animeID, genreID], function (err, result) {
          if (err) throw err;
          if (result.length == 0) {
            let sql = "INSERT INTO tab_categoriser (anime, categorie) VALUES (?, ?)";
            connection.query(sql, [animeID, genreID], function (err, result) {
              if (err) throw err;
            });
          }
        });
      }
    });
  }
}

async function addAnime(nom, affiche, description) {
  return new Promise((resolve, reject) => {
    let sql = "SELECT * FROM tab_liste_anime WHERE nom = ?";
    let nom_url = nom.replace(/ /g, "-").replace(/"/g, "-").replace(/'/g, "-");

    connection.query(sql, [nom], function (err, result) {
      if (err) return reject(err);

      if (result.length == 0) {
        let sql = "INSERT INTO tab_liste_anime (nom, nom_url, affiche_url, description) VALUES (?, ?, ?, ?)";
        connection.query(sql, [nom, nom_url, affiche, description], function (err, insertResult) {
          if (err) return reject(err);
          resolve(insertResult.insertId);
          if(affiche === "https://i.seadn.io/gae/2hDpuTi-0AMKvoZJGd-yKWvK4tKdQr_kLIpB_qSeMau2TNGCNidAosMEvrEXFO9G6tmlFlPQplpwiqirgrIPWnCKMvElaYgI-HiVvXc?auto=format&dpr=1&w=1000") {
              if(nom === 'Wakfu') return;
            client.users.fetch('417391031705796610').then(user => {
              user.send(`L'affiche de l'anime ${nom} n'a pas été trouvée.`);
            });
          }
        });
      } else {
        let animeID = result[0].id;

        if (result[0].affiche_url != affiche && affiche != "https://i.seadn.io/gae/2hDpuTi-0AMKvoZJGd-yKWvK4tKdQr_kLIpB_qSeMau2TNGCNidAosMEvrEXFO9G6tmlFlPQplpwiqirgrIPWnCKMvElaYgI-HiVvXc?auto=format&dpr=1&w=1000") {
          let sql = "UPDATE tab_liste_anime SET affiche_url = ? WHERE id = ?";
          connection.query(sql, [affiche, animeID], function (err) {
            if (err) return reject(err);
            resolve(animeID);
          });
        } else {
          resolve(animeID);
        }
      }
    });
  });
}

await getAllAnimesAndFilms();