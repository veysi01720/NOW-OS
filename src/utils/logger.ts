function maskOpenAIID(id: string): string {
    if (!id) return id;
    if (id.startsWith('vs_')) return 'vs_***' + id.slice(-4);
    if (id.startsWith('file-')) return 'file-***' + id.slice(-4);
    if (id.startsWith('thread_')) return 'thread_***' + id.slice(-4);
    if (id.startsWith('asst_')) return 'asst_***' + id.slice(-4);
    if (id.startsWith('msg_')) return 'msg_***' + id.slice(-4);
    if (id.startsWith('run_')) return 'run_***' + id.slice(-4);
    return id;
}

function maskPhone(phone: string): string {
    if (!phone) return phone;
    // Mask typical phone lengths (10-15 digits)
    return phone.replace(/\b(\d{4})\d+(\d{4})\b/g, '$1***$2');
}

function scrubString(text: string): string {
    if (typeof text !== 'string') return text;
    
    let result = text;
    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (openaiApiKey) {
        result = result.split(openaiApiKey).join('sk-***MOCKED');
    }

    // Mask remoteJid patterns
    result = result.replace(/(\d{4})\d+(\d{4})@s\.whatsapp\.net/g, '$1***$2@s.whatsapp.net');
    result = result.replace(/(\d{4})\d+(\d{4})@g\.us/g, '$1***$2@g.us');
    
    // Mask OpenAI IDs in text
    result = result.replace(/\b(vs_[a-zA-Z0-9]+|file-[a-zA-Z0-9]+|thread_[a-zA-Z0-9]+|asst_[a-zA-Z0-9]+|msg_[a-zA-Z0-9]+|run_[a-zA-Z0-9]+)\b/g, (match) => {
        return maskOpenAIID(match);
    });

    // Mask IBAN and card-like
    result = result.replace(/\b(TR\d{2})\s?(\d{4})\s?(\d{4})\s?(\d{4})\s?(\d{4})\s?(\d{4})\s?(\d{2})\b/gi, '$1***$7');
    result = result.replace(/\b(\d{4})[\s-]?(\d{4})[\s-]?(\d{4})[\s-]?(\d{4})\b/g, '$1***$4');

    return result;
}

function replacer(key: string, value: any): any {
    if (key === 'internal_boss_note') {
        return '*** SCRUBBED INTERNAL NOTE ***';
    }
    if (key === 'remoteJid' && typeof value === 'string') {
        return scrubString(value);
    }
    if (typeof value === 'string') {
        return scrubString(value);
    }
    return value;
}

function formatArgs(args: any[]): string {
    return args.map(arg => {
        if (typeof arg === 'string') return scrubString(arg);
        if (arg instanceof Error) return scrubString(arg.stack || arg.message);
        return JSON.stringify(arg, replacer, 2);
    }).join(' ');
}

export const logger = {
    info: (...args: any[]) => {
        console.log(`[INFO] ${new Date().toISOString()} - ${formatArgs(args)}`);
    },
    warn: (...args: any[]) => {
        console.warn(`[WARN] ${new Date().toISOString()} - ${formatArgs(args)}`);
    },
    error: (...args: any[]) => {
        console.error(`[ERROR] ${new Date().toISOString()} - ${formatArgs(args)}`);
    }
};
