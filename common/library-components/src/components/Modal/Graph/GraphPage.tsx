import React, { useContext, useEffect, useRef, useState } from "react";
import ForceGraph, { ForceGraphInstance } from "force-graph";
import { forceManyBody } from "d3-force";
import clsx from "clsx";

import { getRandomLightColor, openArticle } from "../../../common";
import { CustomGraphData, CustomGraphLink, CustomGraphNode } from "./data";
import { renderNodeObject } from "./canvas";
import { NodeTooltip } from "./Tooltips";
import {
    readingProgressFullClamp,
    ReplicacheContext,
    Topic,
} from "../../../store";
import { TopicEmoji } from "../../TopicTag";

export function GraphPage({
    graph,
    darkModeEnabled,
    currentArticle,
    currentTopic,
}: {
    graph?: CustomGraphData;
    darkModeEnabled: boolean;
    currentArticle?: string;
    currentTopic?: Topic;
}) {
    const rep = useContext(ReplicacheContext);
    const [renderDone, setRenderDone] = useState(false);

    const ref = useRef<HTMLDivElement>(null);
    const forceGraphRef = useRef<ForceGraphInstance>(null);
    const [hoverNode, setHoverNode] = useState<CustomGraphNode | null>(null);
    useEffect(() => {
        if (!ref.current || !graph) {
            return;
        }

        // copy to avoid reducing graph size
        const graphCopy = {
            nodes: graph.nodes.map((node) => ({ ...node })),
            links: graph.links.map((link) => ({ ...link })),
        };

        // wait a bit during intro animation for performance
        const isInitialRender = graphCopy.nodes[0]?.x === undefined;
        setTimeout(
            async () => {
                const topics = await rep?.query.listTopics();
                const topicsById = (topics || []).reduce((acc, topic) => {
                    acc[topic.id] = topic;
                    return acc;
                }, {});

                // filter to topic
                if (currentTopic) {
                    graphCopy.nodes = graphCopy.nodes.filter(
                        (n) =>
                            n.topic_id === currentTopic.id ||
                            topicsById[n.topic_id!]?.group_id ===
                                currentTopic.id
                    );
                    const nodeSet = new Set<string>(
                        graphCopy.nodes.map((n) => n.id)
                    );

                    graphCopy.links = graphCopy.links.filter(
                        (l) =>
                            nodeSet.has(l.source as string) &&
                            nodeSet.has(l.target as string)
                    );
                }

                const forceGraph = renderGraph(
                    graphCopy,
                    ref.current!,
                    darkModeEnabled,
                    setRenderDone,
                    setHoverNode,
                    currentTopic
                );
                // @ts-ignore
                forceGraphRef.current = forceGraph;
            },
            isInitialRender ? 50 : 0
        );
    }, [ref, graph, currentTopic]);

    return (
        <div className="relative h-full w-full overflow-hidden">
            <div
                className={clsx(
                    "graph h-full w-full cursor-move rounded-md bg-stone-50 dark:bg-neutral-800",
                    renderDone && "render-done"
                )}
                ref={ref}
            />
            {hoverNode && forceGraphRef.current && (
                <NodeTooltip
                    {...hoverNode}
                    forceGraph={forceGraphRef.current}
                    currentTopic={currentTopic}
                    darkModeEnabled={darkModeEnabled}
                />
            )}
            {currentTopic && (
                <div
                    className="absolute left-3 right-3 flex items-center rounded-md px-1 py-0.5 font-medium"
                    style={{
                        background: getRandomLightColor(
                            currentTopic.id,
                            darkModeEnabled
                        ),
                    }}
                >
                    {currentTopic.emoji && (
                        <TopicEmoji
                            emoji={currentTopic.emoji}
                            className="w-4"
                        />
                    )}
                    {currentTopic.name}
                </div>
            )}
        </div>
    );
}

export type RuntimeNode = CustomGraphNode & {
    x: number;
    y: number;
    vx: number;
    vy: number;
};

function renderGraph(
    graph: CustomGraphData,
    graphContainer: HTMLDivElement,
    darkModeEnabled: boolean,
    setRenderDone: (done: boolean) => void,
    setHoverNode: (node: CustomGraphNode | null) => void,
    currentTopic?: Topic
): ForceGraphInstance {
    console.log(`rendering graph with ${graph.nodes.length} nodes`);
    const nodes = graph.nodes;
    const links = graph.links;

    const width = graphContainer.clientWidth;
    const height = graphContainer.clientHeight;
    const NODE_R = 3;

    let themeColor = darkModeEnabled
        ? "hsl(51, 80%, 43%)"
        : "hsl(51, 80%, 64%)";
    let secondaryColor = darkModeEnabled ? "#57534e" : "#e5e7eb";
    if (currentTopic) {
        themeColor = getRandomLightColor(currentTopic.id, darkModeEnabled);
    }

    function byDepth(values: any[]) {
        return (item) => values[item.depth] || values[values.length - 1];
    }

    let forceGraph = ForceGraph()(graphContainer)
        // layout
        .graphData({ nodes, links })
        .width(width)
        .height(height)
        // simulation props
        .d3AlphaDecay(0.01)
        .d3VelocityDecay(0.08)
        .warmupTicks(nodes[0]?.x === undefined ? 100 : 0) // use previous positions if available
        .cooldownTicks(0)
        .d3Force("center", (alpha) => {
            nodes.forEach((node: RuntimeNode) => {
                // different strengths for x and y
                node.vy -= node.y * alpha * 0.05;
                node.vx -= node.x * alpha * 0.05;
            });
        })
        .d3Force(
            "charge",
            forceManyBody().strength(byDepth([-50, -50, -40, -20]))
        )
        // node styling
        .nodeRelSize(NODE_R)
        .nodeVal((n: RuntimeNode) => (n.isCompleted ? 2 : 1))
        .nodeColor((n: RuntimeNode) => {
            if (n.depth <= 1 || n.isCompleted || n.isCompletedAdjacent) {
                return themeColor;
            }
            return secondaryColor;
        })
        // .nodeAutoColorBy("topic_id")
        // .nodeLabel("none")
        .onNodeHover((node: CustomGraphNode) => {
            setHoverNode(node || null);
            graphContainer.style.cursor = node ? "pointer" : "move";
        })
        .nodeCanvasObject(renderNodeObject(darkModeEnabled, NODE_R))
        .nodeCanvasObjectMode(() => "after")
        // link styling
        // .linkLabel("score")
        .linkWidth((l: CustomGraphLink) => (l.isCompletedAdjacent ? 5 : 3))
        .linkColor((l: CustomGraphLink) => {
            if (l.depth <= 1 || l.isCompletedAdjacent) {
                return themeColor;
            }
            return secondaryColor;
        });

    // forceGraph.d3Force(
    //     "link",
    //     forceGraph.d3Force("link").distance((l) => l.score * 100)
    // );
    // .d3Force(
    //     "link",
    //     forceLink(links)
    //         .id((n) => n.id)
    //         .strength((l) => l.score)
    // )

    // interaction
    forceGraph
        // .autoPauseRedraw(false) // re-render nodes on hover
        .minZoom(0.5)
        .onNodeClick((node: RuntimeNode, event) => {
            openArticle(node.url);
            // reportEventContentScript("clickGraphArticle", {
            //     libraryUser: libraryState.libraryUser,
            // });
        });

    // zoom
    let initialZoomDone = false;
    let changedZoom = false;
    let currentZoom: number;
    forceGraph
        .minZoom(1.5)
        .maxZoom(5)
        .onEngineStop(() => {
            if (!initialZoomDone) {
                forceGraph.zoomToFit(
                    0,
                    50,
                    (node: RuntimeNode) => node.isCompleted
                );
                forceGraph.cooldownTicks(Infinity);
                initialZoomDone = true;

                // track user zoom changes only after initial zoom
                forceGraph.onZoom((zoom) => {
                    changedZoom = true;
                });

                setRenderDone(true);
            }
        });

    forceGraph.onZoom((zoom) => {
        currentZoom = zoom.k;
    });

    return forceGraph;
}
