/**
 * FileUploadSystem — pick files and send to backend /analyze-file.
 */
export class FileUploadSystem {
    constructor(brain, handlers = {}) {
        this.brain = brain;
        this.h = handlers;
        this.input = null;
    }

    bind(buttonId = 'upload-btn') {
        document.getElementById(buttonId)?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.openPicker();
        });

        if (!this.input) {
            this.input = document.createElement('input');
            this.input.type = 'file';
            this.input.accept = '.txt,.pdf,.docx,.doc,.md,.csv';
            this.input.hidden = true;
            this.input.addEventListener('change', () => this._onPick());
            document.body.appendChild(this.input);
        }
    }

    openPicker() {
        if (this.input) {
            this.input.value = '';
            this.input.click();
        }
    }

    async _onPick() {
        const file = this.input?.files?.[0];
        if (!file) return;
        this.h.onUploadStart?.(file);
        try {
            const data = await this.h.onUpload?.(file);
            this.h.onUploadComplete?.(data, file);
        } catch (err) {
            this.h.onUploadError?.(err, file);
        }
    }
}
