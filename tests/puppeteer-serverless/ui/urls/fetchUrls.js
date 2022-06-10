import { promises as fs } from "fs";
import fetch from "node-fetch";

const excludedDomains = ["twitter.com"];

async function getHnTopLinks(limit = 30) {
    const topResponse = await fetch(
        "https://hacker-news.firebaseio.com/v0/topstories.json"
    );
    const idList = await topResponse.json();

    const itemDetails = await Promise.all(
        idList.slice(0, limit).map(async (id) => {
            try {
                const detailResponse = await fetch(
                    `https://hacker-news.firebaseio.com/v0/item/${id}.json`
                );
                return await detailResponse.json();
            } catch (err) {
                console.error(err);
                return null;
            }
        })
    );

    return itemDetails
        .map((detail) => detail?.url)
        .filter(
            (url) =>
                url &&
                new URL(url).pathname !== "/" &&
                !excludedDomains.includes(new URL(url).host)
        );
}

async function getRedditTopLinks(subreddit, limit = 30) {
    let urls = [];
    let nextToken = null;
    while (urls.length < limit) {
        console.log("request");
        const topResponse = await (
            await fetch(
                `https://www.reddit.com/r/${subreddit}/top/.json?limit=100&after=${nextToken}&count=${urls.length}`
            )
        ).json();

        const newUrls = topResponse.data.children.map(
            (details) => details.data.url
        );
        urls = urls.concat(newUrls);

        nextToken = topResponse.data.after;
    }

    return urls
        .filter(
            (url) =>
                url &&
                new URL(url).pathname !== "/" &&
                !excludedDomains.includes(new URL(url).host)
        )
        .slice(0, limit);
}

async function main() {
    // const urls = await getHnTopLinks(1000);
    // await fs.writeFile("./urls/hn.json", JSON.stringify(urls));

    // repeats after 250 results;, so use multiple subreddits
    let urls = [
        ...(await getRedditTopLinks("worldnews", 300)),
        ...(await getRedditTopLinks("news", 300)),
    ];
    urls = [...new Set(urls)];
    await fs.writeFile("./urls/reddit.json", JSON.stringify(urls));
}
main();