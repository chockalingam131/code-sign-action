import * as core from '@actions/core';
import { promises as fs } from 'fs';
import path from 'path';
import util from 'util';
import { exec } from 'child_process';
import { env } from 'process';

const asyncExec = util.promisify(exec);
const certificateFileName = env['TEMP'] + '\\certificate.pfx';



const signtoolFileExtensions = [
    '.dll', '.exe', '.sys', '.vxd',
    '.msix', '.msixbundle', '.appx',
    '.appxbundle', '.msi', '.msp',
    '.msm', '.cab', '.ps1', '.psm1'
];

function sleep(seconds: number) {
    if (seconds > 0)
        console.log(`Waiting for ${seconds} seconds.`);
    return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

async function getSigntoolLocation(): Promise<string> {
    const windowsKitsfolder = 'C:/Program Files (x86)/Windows Kits/10/bin/';
    const folders = await fs.readdir(windowsKitsfolder);
    let fileName = 'unable to find signtool.exe';
    let maxVersion = 0;
    for (const folder of folders) {
        if (!folder.endsWith('.0')) {
            continue;
        }
        const folderVersion = parseInt(folder.replace(/\./g,''));
        if (folderVersion > maxVersion) {
            const signtoolFilename = `${windowsKitsfolder}${folder}/x64/signtool.exe`;
            try {
                const stat = await fs.stat(signtoolFilename);
                if (stat.isFile()) {
                    fileName = signtoolFilename
                    maxVersion = folderVersion;
                }
            }
            catch {
            }
        }
    }

    console.log(`Signtool location is ${fileName}.`);

    return fileName;
}

async function createCertificatePfx() {
    const base64Certificate = core.getInput('certificate');
    const certificate = Buffer.from(base64Certificate, 'base64');
    if (certificate.length == 0) {
        console.log('The value for "certificate" is not set.');
        return false;
    }
    console.log(`Writing ${certificate.length} bytes to ${certificateFileName}.`);
    await fs.writeFile(certificateFileName, certificate);
    return true;
}

async function addCertificateToStore(){
    try {
        const password : string= core.getInput('password');
        if (password == ''){
            console.log("Password is required to add pfx certificate to store");
            return false; 
        }
        var command = `certutil -f -p ${password} -importpfx ${certificateFileName}` 
        const { stdout } = await asyncExec(command);
        console.log(stdout);
        return true;
    } catch(err) {
        console.log(err.stdout);
        console.log(err.stderr);
        return false;
    }
}

async function signWithSigntool(fileName: string) {
    try {
        // see https://docs.microsoft.com/en-us/dotnet/framework/tools/signtool-exe
        var vitalParameterIncluded = false; 
        var timestampUrl : string = core.getInput('timestampUrl');
        if (timestampUrl === '') {
          timestampUrl = 'http://timestamp.digicert.com';
        }
        const pass : string= core.getInput('password');
        var command = signtool + " sign /debug"
        command = command + ` /f "${certificateFileName}"`
        command = command + " /td SHA256"
        command = command + ` /tr "${timestampUrl}"`
        command = command + ` /p "${pass}"`
        const sha1 : string= core.getInput('certificatesha1');
        if (sha1 != ''){
            command = command + ` /sha1 "${sha1}"`
            vitalParameterIncluded = true; 
        }
       
        if (!vitalParameterIncluded){
            console.log("You need to include a NAME or a SHA1 Hash for the certificate to sign with.")
        }
        command = command + ` ${fileName}`; 
        console.log("Signing command: " + command); 
        console.log("pass: " + pass)
        const { stdout } = await asyncExec(command);
        console.log(stdout);
        return true;
    } catch(err) {
        console.log(err);
        return false;
    }
}

async function trySignFile(fileName: string) {
    console.log(`Signing ${fileName}.`);
    const extension = path.extname(fileName);
    for (let i=0; i< 10; i++) {
        await sleep(i);
        if (signtoolFileExtensions.includes(extension)) {
            if (await signWithSigntool(fileName))
                return;
        }
    }
    throw `Failed to sign '${fileName}'.`;
}

async function signWithSigntoolV1(fileName: string) {
    try {
        // see https://docs.microsoft.com/en-us/dotnet/framework/tools/signtool-exe
        var vitalParameterIncluded = false; 
        var timestampUrl : string = core.getInput('timestampUrl');
        if (timestampUrl === '') {
          timestampUrl = 'http://timestamp.digicert.com';
        }
        
        const signtool = await getSigntoolLocation()
        
        var command = `"${signtool}" sign /f ${certificateFileName} ${/tr ${timestampUrl} /td SHA256`
        const sha1 : string= core.getInput('certificatesha1');
        if (sha1 != ''){
            command = command + ` /sha1 "${sha1}"`
            vitalParameterIncluded = true; 
        }
        const pass : string= core.getInput('password');
        if (pass != ''){
            vitalParameterIncluded = true; 
            command = command + ` /p "${pass}"`
        }
        const name : string= core.getInput('certificatename');
        if (name != ''){
            vitalParameterIncluded = true; 
            command = command + ` /n "${name}"`
        }
        const desc : string= core.getInput('description');
        if (desc != ''){
            vitalParameterIncluded = true; 
            command = command + ` /d "${desc}"`
        }
        if (!vitalParameterIncluded){
            console.log("You need to include a NAME or a SHA1 Hash for the certificate to sign with.")
        }
        command = command + ` ${fileName}`; 
        console.log("Signing command: " + command); 
        const { stdout } = await asyncExec(command);
        console.log(stdout);
        return true;
    } catch(err) {
        console.log(err.stdout);
        console.log(err.stderr);
        return false;
    }
}

async function* getFiles(folder: string, recursive: boolean): any {
    const files = await fs.readdir(folder);
    for (const file of files) {
        const fullPath = `${folder}/${file}`;
        const stat = await fs.stat(fullPath);
        if (stat.isFile()) {
            const extension = path.extname(file);
            if (signtoolFileExtensions.includes(extension) || extension == '.nupkg')
                yield fullPath;
        }
        else if (stat.isDirectory() && recursive) {
            yield* getFiles(fullPath, recursive);
        }
    }
}

async function signFiles() {
    const folder = '';// core.getInput('folder');
  //   if (folder !== '') {
  //      const recursive = core.getInput('recursive') == 'true';
  //      for await (const file of getFiles(folder, recursive)) {
  //          await trySignFile(file);
  //      }
  //   } else {
        const files = core.getMultilineInput('files');
        if (files.length === 0)
            core.setFailed(`Either folder or files should be specified`);
        for (const file of files) {
            await trySignFile(file);
        }
   // }
}

async function run() {
    try {
        if (await createCertificatePfx())
        {
            if (await addCertificateToStore()) 
                await signFiles();
        }
    }
    catch (err) {
        core.setFailed(`Action failed with error: ${err}`);
    }
}

run();
