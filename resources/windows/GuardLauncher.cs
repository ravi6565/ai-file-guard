// Native Windows LPAC launcher. Built locally with the Windows .NET Framework
// compiler; no Docker, WSL, elevation, or loopback exemption is used.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Web.Script.Serialization;

[assembly: System.Runtime.Versioning.TargetFramework(".NETFramework,Version=v4.8")]

public static class GuardLauncher
{
    // Windows SDK WinBase.h: input attributes 9, 15 and 2 respectively.
    private const int SecurityCapabilitiesAttribute = 0x20009;
    private const int AllApplicationPackagesPolicyAttribute = 0x2000F;
    private const int HandleListAttribute = 0x20002;
    public sealed class Configuration
    {
        public string ProfileName;
        public string[] WritableRoots;
        public string[] ReadOnlyRoots;
        public string Executable;
        public string[] Arguments;
        public string WorkingDirectory;
        public Dictionary<string, string> Environment;
    }

    public static int Main(string[] args)
    {
        try
        {
            AppContext.SetSwitch("Switch.System.IO.UseLegacyPathHandling", false);
            AppContext.SetSwitch("Switch.System.IO.BlockLongPaths", false);
            if (args.Length > 0 && args[0] == "--probe-child") return Probe(args);
            if (args.Length != 2 || args[0] != "--config") throw new ArgumentException("Expected --config <trusted launch file>.");
            Configuration config = new JavaScriptSerializer().Deserialize<Configuration>(File.ReadAllText(args[1]));
            return Launch(config);
        }
        catch (Exception error)
        {
            Console.Error.WriteLine("AI File Guard native launcher: " + error.Message);
            return 125;
        }
    }

    private static void Check(bool success, string operation)
    {
        if (!success)
        {
            int code = Marshal.GetLastWin32Error();
            throw new Win32Exception(code, operation + " (Win32 " + code + ": " + new Win32Exception(code).Message + ")");
        }
    }

    private static int Launch(Configuration config)
    {
        if (config == null || String.IsNullOrEmpty(config.ProfileName) || !config.ProfileName.StartsWith("AIFileGuard.", StringComparison.Ordinal) || config.WritableRoots == null || config.WritableRoots.Length == 0)
            throw new ArgumentException("Invalid sandbox configuration.");
        if (!Path.IsPathRooted(config.Executable) || !Path.IsPathRooted(config.WorkingDirectory)) throw new ArgumentException("Absolute executable and working-directory paths are required.");
        IntPtr packageSid;
        int hr = CreateAppContainerProfile(config.ProfileName, "AI File Guard", "Managed AI terminal", IntPtr.Zero, 0, out packageSid);
        if (hr < 0)
        {
            if (hr != unchecked((int)0x800700B7)) Marshal.ThrowExceptionForHR(hr);
            Marshal.ThrowExceptionForHR(DeriveAppContainerSidFromAppContainerName(config.ProfileName, out packageSid));
        }
        IntPtr attributes = IntPtr.Zero, securityBuffer = IntPtr.Zero, capabilitiesBuffer = IntPtr.Zero, policyBuffer = IntPtr.Zero, handlesBuffer = IntPtr.Zero, environment = IntPtr.Zero, job = IntPtr.Zero;
        List<IntPtr> capabilitySids = new List<IntPtr>();
        List<IntPtr> inherited = new List<IntPtr>();
        PROCESS_INFORMATION process = new PROCESS_INFORMATION();
        bool resumed = false;
        try
        {
            SecurityIdentifier identity = new SecurityIdentifier(packageSid);
            foreach (string root in config.WritableRoots) GrantPrivateTree(Path.GetFullPath(root), identity, true);
            foreach (string root in config.ReadOnlyRoots ?? new string[0]) GrantPrivateTree(Path.GetFullPath(root), identity, false);
            // LPAC opts out of the broad ALL APPLICATION PACKAGES grant. No
            // original project, policy directory, or parent directory is granted.
            // Internet client excludes private-network/server capabilities.
            foreach (string name in new string[] { "internetClient", "registryRead" })
                capabilitySids.Add(CapabilitySid(name));
            int capabilitySize = Marshal.SizeOf(typeof(SID_AND_ATTRIBUTES));
            capabilitiesBuffer = Marshal.AllocHGlobal(capabilitySize * capabilitySids.Count);
            for (int i = 0; i < capabilitySids.Count; i++)
                Marshal.StructureToPtr(new SID_AND_ATTRIBUTES { Sid = capabilitySids[i], Attributes = 4 }, IntPtr.Add(capabilitiesBuffer, i * capabilitySize), false);
            SECURITY_CAPABILITIES security = new SECURITY_CAPABILITIES { AppContainerSid = packageSid, Capabilities = capabilitiesBuffer, CapabilityCount = (uint)capabilitySids.Count };
            securityBuffer = Marshal.AllocHGlobal(Marshal.SizeOf(security));
            Marshal.StructureToPtr(security, securityBuffer, false);
            IntPtr size = IntPtr.Zero;
            InitializeProcThreadAttributeList(IntPtr.Zero, 3, 0, ref size);
            attributes = Marshal.AllocHGlobal(size);
            Check(InitializeProcThreadAttributeList(attributes, 3, 0, ref size), "Initialize process attributes");
            Check(UpdateProcThreadAttribute(attributes, 0, new IntPtr(SecurityCapabilitiesAttribute), securityBuffer, new IntPtr(Marshal.SizeOf(security)), IntPtr.Zero, IntPtr.Zero), "Set AppContainer capabilities");
            policyBuffer = Marshal.AllocHGlobal(4);
            Marshal.WriteInt32(policyBuffer, 1); // PROCESS_CREATION_ALL_APPLICATION_PACKAGES_OPT_OUT
            Check(UpdateProcThreadAttribute(attributes, 0, new IntPtr(AllApplicationPackagesPolicyAttribute), policyBuffer, new IntPtr(4), IntPtr.Zero, IntPtr.Zero), "Require less-privileged AppContainer");

            // Only duplicate stdin/out/err. Never inherit the job, policy files,
            // original-file handles, tokens, or arbitrary host handles.
            foreach (int descriptor in new int[] { -10, -11, -12 })
            {
                IntPtr handle;
                Check(DuplicateHandle(GetCurrentProcess(), GetStdHandle(descriptor), GetCurrentProcess(), out handle, 0, true, 2), "Duplicate standard handle");
                inherited.Add(handle);
            }
            handlesBuffer = Marshal.AllocHGlobal(IntPtr.Size * inherited.Count);
            Marshal.Copy(inherited.ToArray(), 0, handlesBuffer, inherited.Count);
            Check(UpdateProcThreadAttribute(attributes, 0, new IntPtr(HandleListAttribute), handlesBuffer, new IntPtr(IntPtr.Size * inherited.Count), IntPtr.Zero, IntPtr.Zero), "Restrict inherited handles");
            STARTUPINFOEX startup = new STARTUPINFOEX();
            startup.StartupInfo.cb = Marshal.SizeOf(startup);
            startup.StartupInfo.dwFlags = 0x100;
            startup.StartupInfo.hStdInput = inherited[0]; startup.StartupInfo.hStdOutput = inherited[1]; startup.StartupInfo.hStdError = inherited[2];
            startup.lpAttributeList = attributes;
            StringBuilder command = new StringBuilder(Quote(config.Executable));
            foreach (string argument in config.Arguments ?? new string[0]) command.Append(" ").Append(Quote(argument));
            List<string> entries = new List<string>();
            foreach (KeyValuePair<string, string> entry in config.Environment)
            {
                if (String.IsNullOrEmpty(entry.Key) || entry.Key.IndexOfAny(new char[] { '=', '\0' }) >= 0 || entry.Value.IndexOf('\0') >= 0) throw new ArgumentException("Invalid environment entry.");
                entries.Add(entry.Key + "=" + entry.Value);
            }
            entries.Sort(StringComparer.OrdinalIgnoreCase);
            environment = Marshal.StringToHGlobalUni(String.Join("\0", entries.ToArray()) + "\0\0");
            job = CreateJobObject(IntPtr.Zero, null);
            Check(job != IntPtr.Zero, "Create process job");
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            limits.BasicLimitInformation.LimitFlags = 0x2000; // KILL_ON_JOB_CLOSE; no breakaway
            int limitsSize = Marshal.SizeOf(limits);
            IntPtr limitsBuffer = Marshal.AllocHGlobal(limitsSize);
            try { Marshal.StructureToPtr(limits, limitsBuffer, false); Check(SetInformationJobObject(job, 9, limitsBuffer, (uint)limitsSize), "Set kill-on-close job"); }
            finally { Marshal.FreeHGlobal(limitsBuffer); }
            // The process is never resumed before assignment to its job succeeds.
            Check(CreateProcess(config.Executable, command, IntPtr.Zero, IntPtr.Zero, true, 0x80000 | 0x400 | 4, environment, config.WorkingDirectory, ref startup, out process), "Create LPAC process");
            // Query the exact suspended child's token from the trusted parent,
            // before allowing any agent instruction to execute.
            VerifyToken(process.hProcess, packageSid);
            Check(AssignProcessToJobObject(job, process.hProcess), "Assign process job");
            Check(ResumeThread(process.hThread) != UInt32.MaxValue, "Resume isolated process");
            resumed = true;
            uint wait = WaitForSingleObject(process.hProcess, UInt32.MaxValue);
            Check(wait == 0, "Wait for isolated process");
            uint exit;
            Check(GetExitCodeProcess(process.hProcess, out exit), "Read isolated exit code");
            return unchecked((int)exit);
        }
        finally
        {
            if (!resumed && process.hProcess != IntPtr.Zero) TerminateProcess(process.hProcess, 125);
            if (job != IntPtr.Zero) CloseHandle(job);
            if (process.hThread != IntPtr.Zero) CloseHandle(process.hThread);
            if (process.hProcess != IntPtr.Zero) CloseHandle(process.hProcess);
            foreach (IntPtr handle in inherited) CloseHandle(handle);
            if (attributes != IntPtr.Zero) { DeleteProcThreadAttributeList(attributes); Marshal.FreeHGlobal(attributes); }
            foreach (IntPtr sid in capabilitySids) LocalFree(sid);
            foreach (IntPtr buffer in new IntPtr[] { securityBuffer, capabilitiesBuffer, policyBuffer, handlesBuffer, environment }) if (buffer != IntPtr.Zero) Marshal.FreeHGlobal(buffer);
            FreeSid(packageSid);
        }
    }

    private static IntPtr CapabilitySid(string name)
    {
        IntPtr groups, capabilities;
        uint groupCount, count;
        Check(DeriveCapabilitySidsFromName(name, out groups, out groupCount, out capabilities, out count), "Derive capability " + name);
        IntPtr result = IntPtr.Zero;
        try
        {
            if (count != 1) throw new InvalidOperationException("Unexpected capability SID count.");
            result = Marshal.ReadIntPtr(capabilities);
            return result;
        }
        finally
        {
            for (int i = 0; i < groupCount; i++) LocalFree(Marshal.ReadIntPtr(groups, i * IntPtr.Size));
            for (int i = 0; i < count; i++) { IntPtr sid = Marshal.ReadIntPtr(capabilities, i * IntPtr.Size); if (sid != result) LocalFree(sid); }
            if (groups != IntPtr.Zero) LocalFree(groups);
            if (capabilities != IntPtr.Zero) LocalFree(capabilities);
        }
    }

    private static void GrantPrivateTree(string root, SecurityIdentifier identity, bool writable)
    {
        if (root == Path.GetPathRoot(root)) throw new ArgumentException("Cannot grant a drive root.");
        // Open without following the final reparse point, verify the handle's
        // actual path, and modify security through that SAME handle. A directory
        // swap must not turn the broker into an ACL/label writer for originals.
        // MAXIMUM_ALLOWED deliberately prevents SetSecurityInfo from propagating
        // inheritable ACL/label changes into unvalidated descendants. Existing
        // children are handled individually below through verified handles.
        string extended = root.StartsWith("\\\\?\\", StringComparison.Ordinal) ? root : root.StartsWith("\\\\", StringComparison.Ordinal) ? "\\\\?\\UNC\\" + root.Substring(2) : "\\\\?\\" + root;
        IntPtr handle = CreateFile(extended, 0x02000000, 7, IntPtr.Zero, 3, 0x02000000 | 0x00200000, IntPtr.Zero);
        bool metadataOnly = false;
        if (handle == new IntPtr(-1) && Marshal.GetLastWin32Error() == 32)
        {
            // A running private executable/current directory can reject DELETE
            // or data-write sharing implicit in MAXIMUM_ALLOWED. Reuse an
            // already verified SID grant without changing its ACL or label.
            handle = CreateFile(extended, 0x20000, 7, IntPtr.Zero, 3, 0x02000000 | 0x00200000, IntPtr.Zero);
            metadataOnly = true;
        }
        Check(handle != new IntPtr(-1), "Open sandbox-private object " + root);
        bool directory;
        try
        {
            BY_HANDLE_FILE_INFORMATION info;
            Check(GetFileInformationByHandle(handle, out info), "Inspect sandbox-private object");
            if ((info.FileAttributes & 0x400) != 0 || info.NumberOfLinks > 1) throw new IOException("Reparse points and hard links are not allowed in sandbox-private storage: " + root);
            directory = (info.FileAttributes & 0x10) != 0;
            StringBuilder actual = new StringBuilder(32768);
            uint count = GetFinalPathNameByHandle(handle, actual, (uint)actual.Capacity, 0);
            Check(count > 0 && count < actual.Capacity, "Resolve sandbox-private handle");
            string actualPath = actual.ToString();
            if (actualPath.StartsWith("\\\\?\\UNC\\", StringComparison.OrdinalIgnoreCase)) actualPath = "\\\\" + actualPath.Substring(8);
            else if (actualPath.StartsWith("\\\\?\\", StringComparison.Ordinal)) actualPath = actualPath.Substring(4);
            if (!String.Equals(Path.GetFullPath(actualPath), root, StringComparison.OrdinalIgnoreCase)) throw new IOException("Sandbox-private path traversed a reparse point: " + root);
            IntPtr owner, group, dacl, sacl, descriptor;
            uint error = GetSecurityInfo(handle, 1, 4, out owner, out group, out dacl, out sacl, out descriptor);
            if (error != 0) throw new Win32Exception((int)error, "Read sandbox-private ACL");
            try
            {
                uint length = GetSecurityDescriptorLength(descriptor);
                byte[] binary = new byte[length]; Marshal.Copy(descriptor, binary, 0, binary.Length);
                RawSecurityDescriptor security = new RawSecurityDescriptor(binary, 0);
                if (security.DiscretionaryAcl == null) throw new IOException("Sandbox-private storage must have a DACL.");
                RawAcl acl = security.DiscretionaryAcl;
                int rights = (int)((writable ? FileSystemRights.Modify : FileSystemRights.ReadAndExecute) | FileSystemRights.Synchronize);
                AceFlags flags = directory ? AceFlags.ContainerInherit | AceFlags.ObjectInherit : AceFlags.None;
                bool granted = false;
                int insert = acl.Count;
                for (int i = 0; i < acl.Count; i++)
                {
                    CommonAce ace = acl[i] as CommonAce;
                    if (ace != null && ace.SecurityIdentifier.Equals(identity) && ace.AceQualifier == AceQualifier.AccessAllowed && (ace.AccessMask & rights) == rights && (ace.AceFlags & flags) == flags) granted = true;
                    if ((acl[i].AceFlags & AceFlags.Inherited) != 0 && insert == acl.Count) insert = i;
                }
                if (metadataOnly && !granted) throw new IOException("Sandbox-private storage is busy and has not been granted to this profile. Close its other terminals and retry: " + root);
                if (!granted) acl.InsertAce(insert, new CommonAce(flags, AceQualifier.AccessAllowed, rights, identity, false, null));
                byte[] aclBytes = new byte[acl.BinaryLength]; acl.GetBinaryForm(aclBytes, 0);
                IntPtr aclBuffer = Marshal.AllocHGlobal(aclBytes.Length);
                try
                {
                    Marshal.Copy(aclBytes, 0, aclBuffer, aclBytes.Length);
                    error = metadataOnly ? 0 : SetSecurityInfo(handle, 1, 4, IntPtr.Zero, IntPtr.Zero, aclBuffer, IntPtr.Zero);
                    if (error != 0) throw new Win32Exception((int)error, "Grant sandbox-private ACL");
                }
                finally { Marshal.FreeHGlobal(aclBuffer); }
            }
            finally { LocalFree(descriptor); }
            if (writable && !metadataOnly) SetLowIntegrity(handle, directory);
        }
        finally { CloseHandle(handle); }
        if (directory) foreach (string child in Directory.GetFileSystemEntries(root)) GrantPrivateTree(child, identity, writable);
    }

    private static void SetLowIntegrity(IntPtr target, bool directory)
    {
        IntPtr descriptor;
        uint length;
        Check(ConvertStringSecurityDescriptorToSecurityDescriptor(directory ? "S:(ML;OICI;NW;;;LW)" : "S:(ML;;NW;;;LW)", 1, out descriptor, out length), "Build private low-integrity label");
        try
        {
            bool present, defaulted; IntPtr sacl;
            Check(GetSecurityDescriptorSacl(descriptor, out present, out sacl, out defaulted), "Read low-integrity label");
            uint error = SetSecurityInfo(target, 1, 0x10, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, sacl);
            if (error != 0) throw new Win32Exception((int)error, "Label sandbox-private storage");
        }
        finally { LocalFree(descriptor); }
    }

    private static string Quote(string argument)
    {
        if (argument.IndexOf('\0') >= 0) throw new ArgumentException("NUL in process argument.");
        // Leave simple switches unquoted: cmd.exe parses switches itself rather
        // than using the C runtime argv parser. Preserve standard escaping for
        // empty arguments, scripts, whitespace and embedded quotes.
        if (argument.Length > 0 && argument.IndexOfAny(new char[] { ' ', '\t', '\n', '\v', '"' }) < 0) return argument;
        StringBuilder result = new StringBuilder("\""); int slashes = 0;
        foreach (char value in argument)
        {
            if (value == '\\') { slashes++; continue; }
            if (value == '"') { result.Append('\\', slashes * 2 + 1).Append('"'); slashes = 0; continue; }
            result.Append('\\', slashes).Append(value); slashes = 0;
        }
        return result.Append('\\', slashes * 2).Append('"').ToString();
    }

    private static int Probe(string[] args)
    {
        if (args.Length != 4) throw new ArgumentException("Invalid probe arguments.");
        string original = args[1], writable = args[2], policy = args[3];
        int denied = 0;
        Action<Action> reject = delegate(Action action)
        {
            try { action(); }
            catch (UnauthorizedAccessException) { denied++; return; }
            catch (FileNotFoundException) { denied++; return; }
            catch (DirectoryNotFoundException) { denied++; return; }
            throw new InvalidOperationException("Original mutation escaped LPAC.");
        };
        reject(delegate { File.WriteAllText(original, "bad"); });
        // Windows can hide an inaccessible object as missing; File.Delete is a
        // no-op in that case. The trusted parent verifies it still exists.
        try { File.Delete(original); } catch (UnauthorizedAccessException) { } catch (IOException) { }
        denied++;
        reject(delegate { File.Move(original, original + ".moved"); });
        reject(delegate { Directory.CreateDirectory(original + ".folder"); });
        reject(delegate { File.WriteAllText(policy, "bad"); });
        File.WriteAllText(Path.Combine(writable, "allowed"), "yes");
        Console.Write("GUARD_VERIFIED:" + denied);
        return 0;
    }

    private static void VerifyToken(IntPtr process, IntPtr packageSid)
    {
        IntPtr token;
        Check(OpenProcessToken(process, 8 | 2 | 0x80, out token), "Query sandbox token");
        try
        {
            int value, size;
            Check(GetTokenInformation(token, 29, out value, 4, out size), "Query AppContainer state");
            if (value != 1) throw new InvalidOperationException("Probe is not an AppContainer.");
            // Class 46 has no supported Win32 output/version contract and is
            // rejected by some Windows builds. Verify documented LPAC access
            // semantics instead: ignore ALL APPLICATION PACKAGES, but honor the
            // exact private package SID. Creation still REQUIRES the LPAC flag.
            IntPtr impersonation;
            Check(DuplicateToken(token, 2, out impersonation), "Duplicate sandbox query token");
            try
            {
                if (CanAccessDescriptor(impersonation, "S-1-15-2-1")) throw new InvalidOperationException("Child accepts the broad ALL APPLICATION PACKAGES grant.");
                if (!CanAccessDescriptor(impersonation, new SecurityIdentifier(packageSid).Value)) throw new InvalidOperationException("Child does not honor its private package SID.");
            }
            finally { CloseHandle(impersonation); }
            GrantDefaultObjectDacl(token, new SecurityIdentifier(packageSid));
        }
        finally { CloseHandle(token); }
    }

    private static void GrantDefaultObjectDacl(IntPtr token, SecurityIdentifier identity)
    {
        // New private kernel objects (including child stdio pipes/processes)
        // must include the package SID, rather than only the host user's SID.
        int size;
        GetTokenInformationBuffer(token, 6, IntPtr.Zero, 0, out size);
        if (size <= 0) throw new InvalidOperationException("Cannot size the default token DACL.");
        IntPtr buffer = Marshal.AllocHGlobal(size), aclBuffer = IntPtr.Zero, information = IntPtr.Zero;
        try
        {
            Check(GetTokenInformationBuffer(token, 6, buffer, size, out size), "Read default object DACL");
            IntPtr acl = Marshal.ReadIntPtr(buffer);
            if (acl == IntPtr.Zero) throw new InvalidOperationException("Default object DACL must not be null.");
            int length = (ushort)Marshal.ReadInt16(acl, 2);
            byte[] bytes = new byte[length]; Marshal.Copy(acl, bytes, 0, bytes.Length);
            RawAcl updated = new RawAcl(bytes, 0);
            updated.InsertAce(updated.Count, new CommonAce(AceFlags.None, AceQualifier.AccessAllowed, 0x10000000, identity, false, null));
            bytes = new byte[updated.BinaryLength]; updated.GetBinaryForm(bytes, 0);
            aclBuffer = Marshal.AllocHGlobal(bytes.Length); Marshal.Copy(bytes, 0, aclBuffer, bytes.Length);
            information = Marshal.AllocHGlobal(IntPtr.Size); Marshal.WriteIntPtr(information, aclBuffer);
            Check(SetTokenInformation(token, 6, information, IntPtr.Size), "Set private default object DACL");
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
            if (aclBuffer != IntPtr.Zero) Marshal.FreeHGlobal(aclBuffer);
            if (information != IntPtr.Zero) Marshal.FreeHGlobal(information);
        }
    }

    private static bool CanAccessDescriptor(IntPtr token, string package)
    {
        IntPtr descriptor; uint length;
        Check(ConvertStringSecurityDescriptorToSecurityDescriptor("O:SYG:SYD:(A;;0x1;;;WD)(A;;0x1;;;" + package + ")", 1, out descriptor, out length), "Build token access probe");
        IntPtr privileges = Marshal.AllocHGlobal(1024);
        try
        {
            GENERIC_MAPPING mapping = new GENERIC_MAPPING { GenericRead = 1, GenericWrite = 2, GenericExecute = 4, GenericAll = 7 };
            uint privilegeLength = 1024, granted; bool allowed;
            Check(AccessCheck(descriptor, token, 1, ref mapping, privileges, ref privilegeLength, out granted, out allowed), "Check LPAC access semantics");
            return allowed && (granted & 1) == 1;
        }
        finally { Marshal.FreeHGlobal(privileges); LocalFree(descriptor); }
    }

    [StructLayout(LayoutKind.Sequential)] private struct SECURITY_CAPABILITIES { public IntPtr AppContainerSid, Capabilities; public uint CapabilityCount, Reserved; }
    [StructLayout(LayoutKind.Sequential)] private struct SID_AND_ATTRIBUTES { public IntPtr Sid; public uint Attributes; }
    [StructLayout(LayoutKind.Sequential)] private struct GENERIC_MAPPING { public uint GenericRead, GenericWrite, GenericExecute, GenericAll; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct STARTUPINFO { public int cb; public string lpReserved, lpDesktop, lpTitle; public uint dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags; public ushort wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError; }
    [StructLayout(LayoutKind.Sequential)] private struct STARTUPINFOEX { public STARTUPINFO StartupInfo; public IntPtr lpAttributeList; }
    [StructLayout(LayoutKind.Sequential)] private struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public uint dwProcessId, dwThreadId; }
    [StructLayout(LayoutKind.Sequential)] private struct JOBOBJECT_BASIC_LIMIT_INFORMATION { public long PerProcessUserTimeLimit, PerJobUserTimeLimit; public uint LimitFlags; public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass, SchedulingClass; }
    [StructLayout(LayoutKind.Sequential)] private struct IO_COUNTERS { public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount; }
    [StructLayout(LayoutKind.Sequential)] private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION { public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation; public IO_COUNTERS IoInfo; public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed; }
    [StructLayout(LayoutKind.Sequential)] private struct FILETIME { public uint Low, High; }
    [StructLayout(LayoutKind.Sequential)] private struct BY_HANDLE_FILE_INFORMATION { public uint FileAttributes; public FILETIME CreationTime, LastAccessTime, LastWriteTime; public uint VolumeSerialNumber, FileSizeHigh, FileSizeLow, NumberOfLinks, FileIndexHigh, FileIndexLow; }

    [DllImport("userenv.dll", CharSet = CharSet.Unicode)] private static extern int CreateAppContainerProfile(string name, string display, string description, IntPtr capabilities, uint count, out IntPtr sid);
    [DllImport("userenv.dll", CharSet = CharSet.Unicode)] private static extern int DeriveAppContainerSidFromAppContainerName(string name, out IntPtr sid);
    [DllImport("kernelbase.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool DeriveCapabilitySidsFromName(string name, out IntPtr groups, out uint groupCount, out IntPtr capabilities, out uint count);
    [DllImport("advapi32.dll")] private static extern IntPtr FreeSid(IntPtr sid);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool GetTokenInformation(IntPtr token, int informationClass, out int information, int length, out int returned);
    [DllImport("advapi32.dll", SetLastError = true, EntryPoint = "GetTokenInformation")] private static extern bool GetTokenInformationBuffer(IntPtr token, int informationClass, IntPtr information, int length, out int returned);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool SetTokenInformation(IntPtr token, int informationClass, IntPtr information, int length);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool DuplicateToken(IntPtr token, int level, out IntPtr duplicate);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool AccessCheck(IntPtr descriptor, IntPtr token, uint desired, ref GENERIC_MAPPING mapping, IntPtr privileges, ref uint privilegeLength, out uint granted, out bool allowed);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(string sddl, uint revision, out IntPtr descriptor, out uint length);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool GetSecurityDescriptorSacl(IntPtr descriptor, out bool present, out IntPtr sacl, out bool defaulted);
    [DllImport("advapi32.dll")] private static extern uint SetSecurityInfo(IntPtr handle, int type, uint information, IntPtr owner, IntPtr group, IntPtr dacl, IntPtr sacl);
    [DllImport("advapi32.dll")] private static extern uint GetSecurityInfo(IntPtr handle, int type, uint information, out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr descriptor);
    [DllImport("advapi32.dll")] private static extern uint GetSecurityDescriptorLength(IntPtr descriptor);
    [DllImport("kernel32.dll")] private static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr GetStdHandle(int descriptor);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool DuplicateHandle(IntPtr sourceProcess, IntPtr source, IntPtr targetProcess, out IntPtr target, uint access, bool inherit, uint options);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
    [DllImport("kernel32.dll")] private static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "CreateProcessW")] private static extern bool CreateProcess(string application, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inherit, uint flags, IntPtr environment, string directory, ref STARTUPINFOEX startup, out PROCESS_INFORMATION process);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool SetInformationJobObject(IntPtr job, int informationClass, IntPtr information, uint length);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("kernel32.dll")] private static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr pointer);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "CreateFileW")] private static extern IntPtr CreateFile(string name, uint access, uint sharing, IntPtr attributes, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetFileInformationByHandle(IntPtr handle, out BY_HANDLE_FILE_INFORMATION information);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "GetFinalPathNameByHandleW")] private static extern uint GetFinalPathNameByHandle(IntPtr handle, StringBuilder path, uint size, uint flags);
}
