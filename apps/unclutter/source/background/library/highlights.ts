import type { Annotation, Article } from "@unclutter/library-components/dist/store";
import { debounce, groupBy } from "lodash";
import { getHypothesisUsername, getHypothesisToken } from "../../common/annotations/storage";
import { getFeatureFlag, hypothesisSyncFeatureFlag } from "../../common/featureFlags";
import { getHypothesisSyncState, updateHypothesisSyncState } from "../../common/storage";
import { rep } from "./library";
import {
    createHypothesisAnnotation,
    deleteHypothesisAnnotation,
    getHypothesisAnnotationsSince,
    updateHypothesisAnnotation,
} from "@unclutter/library-components/dist/common/sync/hypothesis";
import { ReplicacheProxy } from "@unclutter/library-components/dist/common/replicache";

export async function initHighlightsSync() {
    const hypothesisSyncEnabled = await getFeatureFlag(hypothesisSyncFeatureFlag);
    const username = await getHypothesisUsername();
    const apiToken = await getHypothesisToken();
    if (!hypothesisSyncEnabled || !username || !apiToken) {
        return;
    }

    try {
        // upload before download to not endlessly loop
        await uploadAnnotationsToHypothesis(rep, username, apiToken);
        await downloadHypothesisAnnotations(rep, username, apiToken);

        await watchLocalAnnotations(rep, username, apiToken);
    } catch (err) {
        console.error(err);
    }

    console.log("Annotations sync done");
}

export async function downloadHypothesisAnnotations(
    rep: ReplicacheProxy,
    username: string,
    apiToken: string
) {
    const syncState = await getHypothesisSyncState();
    await updateHypothesisSyncState({ isSyncing: true });

    // get last updated time before async fetching & uploading
    // use current time instead of last download to display time ago
    const newUploadTimestamp = new Date().toUTCString();

    let [annotations, articles, newDownloadTimestamp] = await getHypothesisAnnotationsSince(
        username,
        apiToken,
        syncState.lastDownloadTimestamp && new Date(syncState.lastDownloadTimestamp),
        10000
    );

    console.log(
        `Downloading ${annotations.length} hypothes.is annotations since ${syncState.lastDownloadTimestamp}...`
    );

    await rep.mutate.importArticles({ articles });
    await rep.mutate.mergeRemoteAnnotations(annotations);

    await updateHypothesisSyncState({
        lastDownloadTimestamp: newUploadTimestamp,
        isSyncing: false,
    });
}

async function uploadAnnotationsToHypothesis(
    rep: ReplicacheProxy,
    username: string,
    apiToken: string
) {
    const syncState = await getHypothesisSyncState();
    await updateHypothesisSyncState({ isSyncing: true });

    // get last updated time before async fetching & uploading
    const newUploadTimestamp = new Date().toUTCString();

    // filter annotations to upload
    let annotations = await rep.query.listAnnotations();
    const lastUploadUnix = syncState.lastUploadTimestamp
        ? Math.round(new Date(syncState.lastUploadTimestamp).getTime() / 1000)
        : 0;
    annotations = annotations
        .filter((a) => a.updated_at > lastUploadUnix)
        .filter((a) => !a.ai_created || a.text)
        .sort((a, b) => a.updated_at - b.updated_at); // sort with oldest first
    if (annotations.length === 0) {
        await updateHypothesisSyncState({
            lastUploadTimestamp: newUploadTimestamp,
            isSyncing: false,
        });
        return;
    }
    console.log(
        `Uploading ${annotations.length} changed annotations since ${syncState.lastUploadTimestamp} to hypothes.is...`
    );

    // fetch articles
    const articleIds = Object.keys(groupBy(annotations, (a) => a.article_id));
    const articles = await Promise.all(
        articleIds.map((articleId) => rep.query.getArticle(articleId))
    );
    const articleMap: { [articleId: string]: Article } = articles.reduce((acc, article) => {
        acc[article.id] = article;
        return acc;
    }, {});

    // upload changes
    await Promise.all(
        annotations.map(async (annotation) => {
            const article = articleMap[annotation.article_id];

            if (annotation.h_id) {
                // already exists remotely
                return updateHypothesisAnnotation(username, apiToken, annotation);
            } else {
                // create remotely, then save id
                const remoteId = await createHypothesisAnnotation(
                    username,
                    apiToken,
                    annotation,
                    article.url,
                    article.title
                );
                await rep.mutate.updateAnnotation({
                    id: annotation.id,
                    h_id: remoteId,
                });
            }
        })
    );

    await updateHypothesisSyncState({ isSyncing: false, lastUploadTimestamp: newUploadTimestamp });
}
const uploadAnnotationsToHypothesisDebounced = debounce(uploadAnnotationsToHypothesis, 10 * 1000);

// only handle deletes using store watch for reslience
let watchActive = false;
async function watchLocalAnnotations(rep: ReplicacheProxy, username: string, apiToken: string) {
    if (watchActive) {
        return;
    }
    watchActive = true;

    rep.watch("annotations/", async (changed: Annotation[], removed: Annotation[]) => {
        if (changed.length > 0) {
            // process based on edit timestamp for resilience
            uploadAnnotationsToHypothesisDebounced(rep, username, apiToken);
        }
        if (removed.length > 0) {
            console.log(`Deleting ${removed.length} annotation remotely...`);
            await Promise.all(
                removed.map((annotation) =>
                    deleteHypothesisAnnotation(username, apiToken, annotation)
                )
            );
        }
    });
}
