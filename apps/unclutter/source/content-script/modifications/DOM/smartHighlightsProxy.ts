import { PageModifier, trackModifierExecution } from "../_interface";
import { generateId } from "../../../common/annotations/create";
import type AnnotationsModifier from "../annotations/annotationsModifier";
import { createPaintNewAnnotation } from "../annotations/selectionListener";
import { sendIframeEvent } from "../../../common/reactIframe";

// communicate with a SmartHighlightsModifier instance inside the same window
@trackModifierExecution
export default class SmartHighlightsProxy implements PageModifier {
    private annotationsModifier: AnnotationsModifier;

    constructor(annotationsModifier: AnnotationsModifier) {
        this.annotationsModifier = annotationsModifier;

        window.addEventListener("message", (event) => this.handleMessage(event.data || {}));
    }

    private handleMessage(message: any) {
        // "setInfoAnnotations" and "changedDisplayOffset" sidebar events sent directly from smartHighlights.ts

        if (message.type === "clickSmartHighlight") {
            // call createPaintNewAnnotation in enhance.ts for smaller bundle size
            createPaintNewAnnotation(
                message.selector,
                (annotation) => {
                    sendIframeEvent(this.annotationsModifier.sidebarIframe, {
                        event: "createHighlight",
                        annotation,
                    });
                    this.annotationsModifier.onAnnotationUpdate("add", [annotation]);
                },
                this.annotationsModifier.sidebarIframe,
                generateId()
            );
        }
    }
}
