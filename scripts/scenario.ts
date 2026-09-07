import { readFile } from 'node:fs/promises';

import { WorkshopApplication } from '../src/App/WorkshopApplication.ts';
import type { WorkshopCommand, WorkshopCommandResult } from '../src/App/WorkshopApplication.ts';

/** Executes the same public commands as pointer, keyboard and toolbar input. */
async function main(): Promise<void>
{
    const application = new WorkshopApplication();
    const scenario = process.argv[2] ?? 'smoke';
    const results: WorkshopCommandResult[] = [];
    let restoredSaveMatches: boolean | null = null;
    const send = (command: WorkshopCommand): void =>
    {
        const result = application.dispatch(command);
        results.push(result);

        if (!result.accepted)
        {
            throw new Error(`Command ${command.type} rejected: ${result.code ?? 'unknown'}`);
        }
    };

    if (scenario === '--commands')
    {
        const parsed: unknown = JSON.parse(process.argv[3] ?? 'null');

        if (!Array.isArray(parsed) || parsed.length > 10_000)
        {
            throw new Error('Expected a bounded JSON command array.');
        }

        for (const value of parsed)
        {
            send(parseCommand(value));
        }
    }
    else if (scenario === '--restore')
    {
        const savePath = process.argv[3];

        if (savePath === undefined)
        {
            throw new Error('Pass the path of a local exported save.');
        }

        send({ type: 'restore', serialized: await readFile(savePath, 'utf8') });
    }
    else if (scenario === 'smoke' || scenario === 'finish' || scenario === 'complete')
    {
        send({ type: 'sit' });
        send({ type: 'tick', deltaSeconds: 0.6 });
        send({ type: 'focus' });
        send({ type: 'tick', deltaSeconds: 0.4 });

        if (scenario === 'smoke')
        {
            send({ type: 'beginStroke', x: 3, y: 3 });
            send({ type: 'continueStroke', x: 7, y: 3 });
            send({ type: 'endStroke' });
            send({ type: 'undo' });
            send({ type: 'redo' });
        }
        else
        {
            const pattern = application.getReadModel().pattern;

            for (let index = 0; index < pattern.targetNumbers.length; index += 1)
            {
                const colorNumber = pattern.targetNumbers[index];

                if (colorNumber === 0)
                {
                    continue;
                }

                send({ type: 'selectColor', colorNumber });
                send({ type: 'beginStroke', x: index % pattern.width, y: Math.floor(index / pattern.width) });
                send({ type: 'endStroke' });
            }

            send({ type: 'startIroning' });

            for (let index = 0; index < pattern.targetNumbers.length; index += 1)
            {
                send({ type: 'ironCell', x: index % pattern.width, y: Math.floor(index / pattern.width) });
            }

            const saved = application.exportSave();
            send({ type: 'restore', serialized: saved });
            restoredSaveMatches = application.exportSave() === saved;
        }
    }
    else
    {
        throw new Error('Usage: scenario [smoke|finish|--commands JSON_ARRAY|--restore SAVE_PATH]');
    }

    const model = application.getReadModel();
    process.stdout.write(`${JSON.stringify({
        scenario,
        commandsAccepted: results.length,
        mode: model.mode,
        avatar: model.avatar,
        patternId: model.pattern.patternId,
        selectedColor: model.selectedColor,
        correctCellCount: model.board.correctCellCount,
        errorCellCount: model.board.errorCellCount,
        targetCellCount: model.board.targetCellCount,
        stage: model.stage,
        ironProgress: model.ironProgress,
        finishedArtworkIds: model.finishedArtworks.map((artwork) => artwork.artworkId),
        restoredSaveMatches
    })}\n`);
}

function parseCommand(value: unknown): WorkshopCommand
{
    if (typeof value !== 'object' || value === null || !('type' in value))
    {
        throw new Error('Invalid command record.');
    }

    switch (value.type)
    {
        case 'sit':
        case 'stand':
        case 'focus':
        case 'retreat':
        case 'pauseStroke':
        case 'endStroke':
        case 'undo':
        case 'redo':
        case 'reset':
        case 'startIroning':
        case 'cancelIroning':
            return { type: value.type };
        case 'tick':
            if ('deltaSeconds' in value && typeof value.deltaSeconds === 'number')
            {
                return { type: 'tick', deltaSeconds: value.deltaSeconds };
            }
            break;
        case 'move':
            if ('x' in value && typeof value.x === 'number'
                && 'z' in value && typeof value.z === 'number'
                && 'deltaSeconds' in value && typeof value.deltaSeconds === 'number')
            {
                return { type: 'move', x: value.x, z: value.z, deltaSeconds: value.deltaSeconds };
            }
            break;
        case 'selectColor':
            if ('colorNumber' in value && typeof value.colorNumber === 'number')
            {
                return { type: 'selectColor', colorNumber: value.colorNumber };
            }
            break;
        case 'selectTool':
            if ('tool' in value && (value.tool === 'place' || value.tool === 'erase'))
            {
                return { type: 'selectTool', tool: value.tool };
            }
            break;
        case 'beginStroke':
        case 'continueStroke':
        case 'ironCell':
            if ('x' in value && typeof value.x === 'number' && 'y' in value && typeof value.y === 'number')
            {
                return { type: value.type, x: value.x, y: value.y };
            }
            break;
        case 'selectPattern':
            if ('patternId' in value && typeof value.patternId === 'string')
            {
                return { type: 'selectPattern', patternId: value.patternId };
            }
            break;
        case 'restore':
            if ('serialized' in value && typeof value.serialized === 'string')
            {
                return { type: 'restore', serialized: value.serialized };
            }
            break;
    }

    throw new Error('Invalid command fields.');
}

main().catch((error: unknown) =>
{
    process.stderr.write(`${error instanceof Error ? error.message : 'Scenario failed.'}\n`);
    process.exitCode = 1;
});
